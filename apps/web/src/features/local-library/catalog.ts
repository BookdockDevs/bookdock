import type { ArchiveBooksQuery, ReadingRange, EditorEpubSaveReq, EditorTxtSaveReq, ClientReadingLedgerClear, BatchOrganizeReq, ClientBatchSelectionItem, ClientBook, ClientBookRef, ClientDataScope, ClientOrganization, ClientReadingState, ClientShelfItem, LibrarySearchExpression } from '@bookdock/shared'
import { PAGINATION, classificationValueKey, parseCategoryValueKey, readLibrarySearchExpression } from '@bookdock/shared'

import type { CatalogPage, CatalogQuery } from '../reading-data/catalog'
import { localCatalogEntry } from '../reading-data/catalog'
import { assertSourceBook } from '../reading-data/source'
import { LocalLibraryError, LocalLibraryRepository, localLibraryRepository } from './repository'
import { createCoverThumbnail } from './cover-thumbnail'
import { LOCAL_VAULT_ID, localRecordId } from './id'
import { addLocalBook } from './ingest'
import { readPublicationMetadata } from './publication-metadata'
import { projectLocalVaultReading } from './vault-reading-projection'
import { saveLocalTxt, readLocalEpub, saveLocalEpub } from './publication-editor'
import { projectLocalArchive, projectLocalArchiveEntries, projectLocalArchivePage } from './archive-projection'

/**
 * Vault operations bound to the device vault, independent of any view-source
 * context: the unified bookshelf dispatches local-book items here while the
 * route itself is not a local route.
 */
export const DEVICE_VAULT_SCOPE = { kind: 'local', vaultId: LOCAL_VAULT_ID } as const

export function deviceCatalogOperations() {
  return localCatalogOperations(DEVICE_VAULT_SCOPE)
}

export function localCatalogOperations(scope: Extract<ClientDataScope, { kind: 'local' }>, repository: LocalLibraryRepository = localLibraryRepository) {
  return {
    scope,
    addFile: (file: File, identity: Parameters<typeof addLocalBook>[2]) => addLocalBook(file, scope.vaultId, identity, repository),
    findDuplicate: (file: File, signal?: AbortSignal) => repository.findDuplicateBookByFile(scope.vaultId, file, signal),
    inspectStorage: () => repository.inspectStorage(scope.vaultId),
    readCatalog: () => repository.readCatalog(scope.vaultId), 
    readTxtSource(ref: ClientBookRef, revision: string, signal: AbortSignal) { assertSourceBook(scope, ref); return repository.getNormalizedTxt(ref, revision, signal) },
    saveTxt(ref: ClientBookRef, draft: EditorTxtSaveReq, contentId: string, signal: AbortSignal) { assertSourceBook(scope, ref); return saveLocalTxt(ref, draft, contentId, signal, repository) },
    readEpubSource(ref: ClientBookRef, revision: string, signal: AbortSignal) { assertSourceBook(scope, ref); return readLocalEpub(ref, revision, signal, repository) },
    saveEpub(ref: ClientBookRef, draft: EditorEpubSaveReq, contentId: string, signal: AbortSignal) { assertSourceBook(scope, ref); return saveLocalEpub(ref, draft, contentId, signal, repository) },
    async epubResources(ref: ClientBookRef, revision: string, signal: AbortSignal) {
      assertSourceBook(scope, ref)
      await repository.assertPublicationRevision(ref, revision)
      const file = await repository.getFile(ref)
      const { describeEditorEpub } = await import('./epub-editor')
      const entries = await describeEditorEpub(file, signal)
      await repository.assertPublicationRevision(ref, revision)
      return { kind: 'local' as const, file, revisionId: revision, entries }
    },
    async editorAccess(ref: ClientBookRef, revision: string) {
      assertSourceBook(scope, ref)
      const book = await repository.getBook(ref)
      if (book.content?.contentId !== revision) throw new LocalLibraryError('conflict', 'Publication revision changed')
      if (!await repository.hasPublication(ref)) throw new LocalLibraryError('unavailable-content', 'Publication source is unavailable')
      return { data: { revisionId: revision } }
    },
    clearReadingLedger(command: Omit<ClientReadingLedgerClear, 'scope'>) { assertSourceBook(scope, command.book); return repository.clearReadingLedger(command) },
    clearBookArchive(command: ClientReadingLedgerClear) { assertSourceBook(scope, command.book); return repository.clearBookArchive(command) },
    readReadingSnapshot: () => repository.readVaultReadingSnapshot(scope.vaultId),
    async getReadingProjection(range?: ReadingRange, today?: string) { return projectLocalVaultReading(await repository.readVaultReadingSnapshot(scope.vaultId), range, today) },
    async getArchiveOverview(range?: ReadingRange) { return projectLocalArchive(await repository.readVaultReadingSnapshot(scope.vaultId), range).overview },
    async getArchiveBooks(query: ArchiveBooksQuery) { return projectLocalArchivePage(await repository.readVaultReadingSnapshot(scope.vaultId), query) },
    /** Ordered rows without pagination: the merged archive slices after merging. */
    async getArchiveBookEntries(query: ArchiveBooksQuery) { return projectLocalArchiveEntries(await repository.readVaultReadingSnapshot(scope.vaultId), query) },
    /** Whether this vault holds the book, so the archive can dispatch per book. */
    async hasBook(bookId: string) { return (await repository.readCatalog(scope.vaultId)).books.some(({ book }) => book.ref.bookId === bookId) },
    getCatalogPreferences: () => repository.getCatalogPreferences(scope.vaultId),
    patchCatalogPreferences: (patch: Parameters<LocalLibraryRepository['patchCatalogPreferences']>[1]) => repository.patchCatalogPreferences(scope.vaultId, patch),
    getTrashSettings: () => repository.getTrashSettings(scope.vaultId),
    patchTrashSettings: (patch: Parameters<LocalLibraryRepository['patchTrashSettings']>[1]) => repository.patchTrashSettings(scope.vaultId, patch),
    trash(ref: ClientBookRef, deleteUserData = false) { assertSourceBook(scope, ref); return repository.trashBook(ref, deleteUserData) },
    restore(ref: ClientBookRef, expectedVersion?: number) { assertSourceBook(scope, ref); return repository.restoreBook(ref, expectedVersion) },
    restoreSelection: (targets: Array<{ id: string; version: number }>) => repository.restoreSelection(scope.vaultId, targets),
    purge(ref: ClientBookRef, expectedVersion?: number) { assertSourceBook(scope, ref); return repository.purgeBook(ref, expectedVersion) },
    emptyTrash: () => repository.emptyTrash(scope.vaultId),
    toggleHidden: () => repository.toggleCatalogHidden(scope.vaultId),
    getBookPreferences(ref: ClientBookRef) { assertSourceBook(scope, ref); return repository.getPreferences(ref) },
    getCover(ref: ClientBookRef) { assertSourceBook(scope, ref); return repository.getCover(ref) },
    getCovers(refs: readonly ClientBookRef[]) { for (const ref of refs) assertSourceBook(scope, ref); return repository.getCovers(refs) },
    getMetadataSource(ref: ClientBookRef, signal: AbortSignal) { assertSourceBook(scope, ref); return readPublicationMetadata(repository, ref, signal) },
    async acknowledgeIngestion(ref: ClientBookRef, file: Blob) {
      assertSourceBook(scope, ref)
      const book = await repository.getBook(ref)
      await repository.getFile(ref)
      const prepared = book.format === 'txt' ? { publication: await repository.getPublicationFile(ref), normalizedText: await repository.getNormalizedText(ref) } : undefined
      return repository.addBook(book, file, undefined, prepared)
    },
    setReadStatus(ref: ClientBookRef, status: Parameters<LocalLibraryRepository['setReadStatus']>[1]) { assertSourceBook(scope, ref); return repository.setReadStatus(ref, status) },
    remove(ref: ClientBookRef, complete = false, expectedVersion?: number) { assertSourceBook(scope, ref); return repository.removeBook(ref, complete, expectedVersion) },
    async selection(ids: string[]): Promise<ClientBatchSelectionItem[]> {
      const snapshot = await repository.readCatalog(scope.vaultId)
      const selected = new Set(ids)
      if (selected.size !== ids.length || !ids.length || ids.length > 2000) throw new LocalLibraryError('invalid-input', 'Invalid book selection')
      return snapshot.books.filter(({ book }) => selected.has(book.ref.bookId)).map(({ book }) => ({
        id: book.ref.bookId, ref: book.ref, clientVersion: book.version, title: book.title, format: book.format,
        categoryPath: book.catalog?.categoryPath ?? null, shelfId: book.catalog?.shelfId ?? null, tags: book.catalog?.tags ?? [],
        hidden: book.catalog?.hidden ?? false, pinnedAt: book.catalog?.pinnedAt ?? null,
      }))
    },
    async updateSelection(items: ClientBatchSelectionItem[], patch: Partial<Omit<BatchOrganizeReq, 'ids'>> & { pinned?: boolean; hidden?: boolean }) {
      const changes = items.map((item) => {
        if (!item.ref || item.ref.bookId !== item.id || item.clientVersion === undefined) throw new LocalLibraryError('invalid-input', 'A source-owned selection version is required')
        assertSourceBook(scope, item.ref)
        const tags = new Set(item.tags ?? [])
        for (const name of patch.removeTags ?? []) tags.delete(name)
        for (const name of patch.addTags ?? []) tags.add(name)
        const categoryPath = patch.categoryPath
        return { ref: item.ref, expectedVersion: item.clientVersion, patch: {
          catalog: {
            ...(patch.shelfId === undefined ? {} : { shelfId: patch.shelfId }),
            ...(categoryPath === undefined ? {} : { categoryPath }),
            ...(patch.addTags === undefined && patch.removeTags === undefined ? {} : { tags: [...tags] }),
            ...(patch.pinned === undefined ? {} : { pinnedAt: patch.pinned ? Date.now() : null }),
            ...(patch.hidden === undefined ? {} : { hidden: patch.hidden }),
          },
        } }
      })
      await repository.updateBooksMetadata(changes)
    },
    async list(query: CatalogQuery, signal?: AbortSignal): Promise<CatalogPage> {
      signal?.throwIfAborted()
      if (!Number.isInteger(query.page) || query.page < 1 || !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > PAGINATION.MAX_PAGE_SIZE) throw new LocalLibraryError('invalid-input', 'Invalid catalog page')
      if (!['title', 'author', 'createdAt', 'updatedAt', 'lastReadAt', 'progress', 'size', 'format', 'deletedAt'].includes(query.sortBy) || !['asc', 'desc'].includes(query.sortOrder)) throw new LocalLibraryError('invalid-input', 'Unsupported catalog sort')
      const { books, organization } = await repository.readCatalog(scope.vaultId)
      signal?.throwIfAborted()
      const expression = query.expression ? readLibrarySearchExpression(query.expression) : null
      // A category filter is a name path, and naming a root selects its branch.
      const target = query.category ?? null
      const matchesCategory = (path: string[] | null, selected: string[] | 'none' | null = target): boolean => {
        if (!selected) return true
        if (selected === 'none') return path === null
        return path !== null && selected.every((name, index) => path[index] === name)
      }
      const valueState = (kind: 'category' | 'tag', value: string) => organization.valueState.find((state) => state.kind === kind && state.value === value)
      const categoryHidden = (path: string[] | null): boolean => {
        if (!path) return false
        if (valueState('category', classificationValueKey('category', path))?.hidden) return true
        return path.length > 1 && Boolean(valueState('category', classificationValueKey('category', [path[0]!]))?.hidden)
      }
      const matchesExpression = (book: ClientBook, state: ClientReadingState | null, node: LibrarySearchExpression): boolean => {
        if (node.kind === 'and') return matchesExpression(book, state, node.left) && matchesExpression(book, state, node.right)
        if (node.kind === 'or') return matchesExpression(book, state, node.left) || matchesExpression(book, state, node.right)
        if (node.kind === 'not') return !matchesExpression(book, state, node.child)
        if (node.kind === 'text') return `${book.title} ${book.authors.join(' ')}`.toLocaleLowerCase().includes(node.value.toLocaleLowerCase())
        if (node.kind !== 'field') throw new LocalLibraryError('invalid-input', 'Unsupported search expression')
        if (node.field === 'format') return book.format === node.value
        if (node.field === 'status') return (state?.readStatus ?? 'reading') === node.value
        if (node.field === 'author') return book.authors.includes(node.value)
        if (node.field === 'shelf') return node.value === 'none' ? !book.catalog?.shelfId : book.catalog?.shelfId === (node.id ?? node.value)
        if (node.field === 'tag') {
          const name = node.id ?? node.value
          return Boolean(book.catalog?.tags?.includes(name))
        }
        const path = parseCategoryValueKey(node.id ?? node.value)
        return path === null ? !book.catalog?.categoryPath : matchesCategory(book.catalog?.categoryPath ?? null, path)
      }
      const filtered: typeof books = books.filter(({ book, state }) => {
        if ((book.deletedAt != null) !== Boolean(query.trash) || !query.trash && book.catalogRemoved) return false
        const catalog = book.catalog
        const hiddenTag = (catalog?.tags ?? []).some((name) => valueState('tag', name)?.hidden)
        if (!query.showHidden && (catalog?.hidden
          || (catalog?.shelfId && organization.shelves.find((shelf) => shelf.id === catalog.shelfId)?.hidden)
          || categoryHidden(catalog?.categoryPath ?? null)
          || hiddenTag)) return false
        if (expression && !matchesExpression(book, state, expression)) return false
        if (!expression && query.search && !`${book.title} ${book.authors.join(' ')}`.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())) return false
        if (query.shelfId && !(query.shelfId === 'none' ? !catalog?.shelfId : catalog?.shelfId === query.shelfId)) return false
        if (target && !matchesCategory(catalog?.categoryPath ?? null)) return false
        if (query.tag && !catalog?.tags?.includes(query.tag)) return false
        if (query.author && !book.authors.includes(query.author)) return false
        if (query.series && catalog?.metadata?.series !== query.series) return false
        if (query.format && book.format !== query.format) return false
        if (query.readStatus && (state?.readStatus ?? 'reading') !== query.readStatus) return false
        return true
      })
      const sortValue = ({ book, state }: typeof books[number]): string | number | null => {
        switch (query.sortBy) {
          case 'title': return book.title
          case 'author': return book.authors[0] ?? null
          case 'deletedAt': return book.deletedAt ?? null
          case 'createdAt': return book.createdAt
          case 'updatedAt': return book.updatedAt
          case 'lastReadAt': return state?.lastReadAt ?? null
          case 'progress': return state?.fraction ?? null
          case 'size': return book.size
          case 'format': return book.format
          default: throw new LocalLibraryError('invalid-input', 'Unsupported catalog sort')
        }
      }
      filtered.sort((a, b) => {
        const pin = (b.book.catalog?.pinnedAt ?? 0) - (a.book.catalog?.pinnedAt ?? 0)
        if (pin) return pin
        const left = sortValue(a), right = sortValue(b)
        if (left === null || right === null) return left === right ? a.book.ref.bookId.localeCompare(b.book.ref.bookId) : left === null ? 1 : -1
        const compared = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right))
        return (query.sortOrder === 'asc' ? compared : -compared) || a.book.ref.bookId.localeCompare(b.book.ref.bookId)
      })
      return { entries: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map(({ book, state }) => localCatalogEntry(book, state)),
        total: filtered.length, totalSize: filtered.some(({ book }) => book.size === null) ? null : filtered.reduce((sum, { book }) => sum + book.size!, 0), organization }
    },
    async detail(ref: ClientBookRef, signal?: AbortSignal) {
      assertSourceBook(scope, ref)
      signal?.throwIfAborted()
      const { books, organization } = await repository.readCatalog(scope.vaultId)
      signal?.throwIfAborted()
      const row = books.find(({ book }) => book.ref.bookId === ref.bookId)
      if (!row) throw new LocalLibraryError('unavailable-content', 'Local book no longer exists')
      return { ...localCatalogEntry(row.book, row.state), organization }
    },
    async update(ref: ClientBookRef, patch: Parameters<LocalLibraryRepository['updateMetadata']>[1], expectedVersion: number, cover?: Blob | null) {
      assertSourceBook(scope, ref)
      const preparedCover = cover ? (await createCoverThumbnail(cover)) ?? cover : cover
      return repository.updateMetadata(ref, patch, expectedVersion, preparedCover)
    },
    getOrganization: () => repository.getOrganization(scope.vaultId),
    saveOrganization: (value: ClientOrganization, expectedVersion: number) => repository.saveOrganization(scope.vaultId, value, expectedVersion),
    async createShelf(name: string) {
      const current = await repository.getOrganization(scope.vaultId)
      const now = Date.now()
      const shelf = { id: localRecordId(), name, pinned: false, hidden: false, sortOrder: Math.max(-1, ...current.shelves.map((entry) => entry.sortOrder)) + 1, createdAt: now, updatedAt: now }
      await repository.saveOrganization(scope.vaultId, { ...current, shelves: [...current.shelves, shelf] }, current.version)
      return shelf
    },
    async updateShelf(id: string, patch: Partial<Pick<ClientShelfItem, 'name' | 'pinned' | 'hidden'>>) {
      const current = await repository.getOrganization(scope.vaultId)
      const shelf = current.shelves.find((entry) => entry.id === id)
      if (!shelf) throw new LocalLibraryError('conflict', 'Shelf no longer exists')
      const next = { ...shelf, ...patch, updatedAt: Date.now() }
      await repository.saveOrganization(scope.vaultId, { ...current, shelves: current.shelves.map((entry) => entry.id === id ? next : entry) }, current.version)
      return next
    },
    async deleteShelf(id: string) {
      const current = await repository.getOrganization(scope.vaultId)
      if (!current.shelves.some((entry) => entry.id === id)) throw new LocalLibraryError('conflict', 'Shelf no longer exists')
      await repository.saveOrganization(scope.vaultId, { ...current, shelves: current.shelves.filter((entry) => entry.id !== id) }, current.version)
    },
    async reorderShelves(orderedIds: string[]) {
      const current = await repository.getOrganization(scope.vaultId)
      const requested = new Set(orderedIds)
      if (requested.size !== orderedIds.length || orderedIds.some((id) => !current.shelves.some((entry) => entry.id === id))) throw new LocalLibraryError('invalid-input', 'Invalid shelf order')
      const entries = [...current.shelves].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      let index = 0
      const order = entries.map((entry) => requested.has(entry.id) ? orderedIds[index++]! : entry.id)
      const ranks = new Map(order.map((id, rank) => [id, rank]))
      await repository.saveOrganization(scope.vaultId, { ...current, shelves: current.shelves.map((entry) => ({ ...entry, sortOrder: ranks.get(entry.id)!, updatedAt: Date.now() })) }, current.version)
    },
    /** Hide, pin or re-order one category/tag value the way the sidebar sees it. */
    setValueState: (kind: 'category' | 'tag', value: string, patch: { pinned?: boolean; hidden?: boolean; sortOrder?: number }) => repository.setValueState(scope.vaultId, kind, value, patch),
    /** Persist a manual order for the values the sidebar lists. */
    async reorderValues(kind: 'category' | 'tag', values: string[]) {
      const current = await repository.getOrganization(scope.vaultId)
      const now = Date.now()
      const ranks = new Map(values.map((value, index) => [value, index]))
      const known = new Set(current.valueState.filter((state) => state.kind === kind).map((state) => state.value))
      const valueState = [
        ...current.valueState.map((state) => state.kind === kind && ranks.has(state.value) ? { ...state, sortOrder: ranks.get(state.value)! } : state),
        ...values.filter((value) => !known.has(value)).map((value) => ({ kind, value, pinned: false, hidden: false, sortOrder: ranks.get(value)!, createdAt: now, updatedAt: now })),
      ]
      await repository.saveOrganization(scope.vaultId, { ...current, valueState }, current.version)
    },
    /**
     * Rewrite one value on every book that carries it: `to` is the new canonical
     * key, or null to clear it. Renaming a category root moves its whole branch,
     * and the sidebar's preferences follow the value.
     */
    async rewriteValue(kind: 'category' | 'tag', from: string, to: string | null, statePatch: { pinned?: boolean; hidden?: boolean } = {}) {
      const snapshot = await repository.readCatalog(scope.vaultId)
      if (kind === 'category' && to !== null) {
        const fromPath = parseCategoryValueKey(from)
        const toPath = parseCategoryValueKey(to)
        if (!fromPath || !toPath) throw new LocalLibraryError('invalid-input', 'Invalid category path')
        const paths = [
          ...snapshot.books.flatMap(({ book }) => book.catalog?.categoryPath ? [book.catalog.categoryPath] : []),
          ...snapshot.organization.valueState
            .filter((state) => state.kind === 'category')
            .flatMap((state) => {
              const path = parseCategoryValueKey(state.value)
              return path ? [path] : []
            }),
        ]
        if (paths.some((path) => fromPath.every((name, index) => path[index] === name)
          && [...toPath, ...path.slice(fromPath.length)].length > 2)) {
          throw new LocalLibraryError('invalid-input', 'Category paths cannot exceed two levels')
        }
      }
      const changes: Array<{ ref: ClientBookRef; expectedVersion: number; patch: { catalog: { tags?: string[]; categoryPath?: string[] | null } } }> = []
      for (const { book } of snapshot.books) {
        if (book.ref.scope.kind !== 'local' || book.version === undefined) continue
        const catalog = book.catalog
        if (!catalog) continue
        if (kind === 'tag') {
          if (!catalog.tags?.includes(from)) continue
          const tags = to === null ? catalog.tags.filter((name) => name !== from) : [...new Set(catalog.tags.map((name) => name === from ? to : name))]
          changes.push({ ref: book.ref, expectedVersion: book.version, patch: { catalog: { tags } } })
          continue
        }
        const path = catalog.categoryPath
        if (!path) continue
        const key = classificationValueKey('category', path)
        const rootKey = classificationValueKey('category', [path[0]!])
        if (key !== from && rootKey !== from) continue
        const targetPath = to === null ? null : JSON.parse(to) as string[]
        // A root rename moves the whole branch: the leaf keeps its own name.
        const next = targetPath === null ? null : key === from ? targetPath : [targetPath[0]!, ...path.slice(1)]
        changes.push({ ref: book.ref, expectedVersion: book.version, patch: { catalog: { categoryPath: next } } })
      }
      await repository.rewriteClassificationValue(scope.vaultId, kind, from, to, changes, statePatch)
    },
    /**
     * Remember the shelves the user is looking at, so a device book can sit on
     * one that only the server can enumerate.
     */
    async mirrorShelves(shelves: readonly ClientShelfItem[]) {
      await repository.mirrorShelves(scope.vaultId, shelves)
    },
    /** Follow the account's shelves; categories and tags are values, so they need no mirror. */
    async syncAccountShelves(shelves: ReadonlyArray<{ id: string; name: string; sortOrder: number }>) {
      await repository.syncAccountShelves(scope.vaultId, [...shelves])
    },
  }
}
