import type { ArchiveBooksQuery, ReadingRange, EditorEpubSaveReq, EditorTxtSaveReq, ClientReadingLedgerClear, BatchOrganizeReq, ClientBatchSelectionItem, ClientBook, ClientBookRef, ClientDataScope, ClientOrganization, ClientReadingState, LibrarySearchExpression } from '@bookdock/shared'
import { PAGINATION, readLibrarySearchExpression } from '@bookdock/shared'

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
        categoryId: book.catalog?.categoryId ?? null, shelfId: book.catalog?.shelfId ?? null, tagIds: book.catalog?.tagIds ?? [],
        hidden: book.catalog?.hidden ?? false, pinnedAt: book.catalog?.pinnedAt ?? null,
      }))
    },
    async updateSelection(items: ClientBatchSelectionItem[], patch: Partial<Omit<BatchOrganizeReq, 'ids'>> & { pinned?: boolean; hidden?: boolean }) {
      const changes = items.map((item) => {
        if (!item.ref || item.ref.bookId !== item.id || item.clientVersion === undefined) throw new LocalLibraryError('invalid-input', 'A source-owned selection version is required')
        assertSourceBook(scope, item.ref)
        const tags = new Set(item.tagIds)
        for (const id of patch.removeTagIds ?? []) tags.delete(id)
        for (const id of patch.addTagIds ?? []) tags.add(id)
        return { ref: item.ref, expectedVersion: item.clientVersion, patch: {
          ...(patch.categoryTemplateKey ? { categoryTemplateKey: patch.categoryTemplateKey } : {}),
          catalog: {
            ...(patch.shelfId === undefined ? {} : { shelfId: patch.shelfId }),
            ...(patch.categoryId === undefined ? {} : { categoryId: patch.categoryId }),
            ...(patch.addTagIds === undefined && patch.removeTagIds === undefined ? {} : { tagIds: [...tags] }),
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
      const descendants = new Set(query.categoryId ? [query.categoryId] : [])
      for (let previous = -1; previous !== descendants.size;) {
        previous = descendants.size
        for (const item of organization.items) if (item.kind === 'category' && item.parentId && descendants.has(item.parentId)) descendants.add(item.id)
      }
      const matchesOrganization = (book: ClientBook, kind: 'shelf' | 'category' | 'tag', id: string): boolean => {
        if (kind === 'tag') return id === 'none' ? !book.catalog?.tagIds?.length : Boolean(book.catalog?.tagIds?.includes(id))
        const ownId = kind === 'shelf' ? book.catalog?.shelfId : book.catalog?.categoryId
        return id === 'none' ? !ownId : ownId === id
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
        const id = node.id ?? organization.items.find((item) => item.kind === node.field && item.name === node.value)?.id
        return id !== undefined && matchesOrganization(book, node.field, id)
      }
      const hiddenIds = new Set(organization.items.filter((item) => item.hidden).map((item) => item.id))
      for (let previous = -1; previous !== hiddenIds.size;) {
        previous = hiddenIds.size
        for (const item of organization.items) if (item.parentId && hiddenIds.has(item.parentId)) hiddenIds.add(item.id)
      }
      const filtered = books.filter(({ book, state }) => {
        if ((book.deletedAt != null) !== Boolean(query.trash) || !query.trash && book.catalogRemoved) return false
        const catalog = book.catalog
        if (!query.showHidden && (catalog?.hidden || (catalog?.shelfId && hiddenIds.has(catalog.shelfId)) || (catalog?.categoryId && hiddenIds.has(catalog.categoryId)) || catalog?.tagIds?.some((id) => hiddenIds.has(id)))) return false
        if (expression && !matchesExpression(book, state, expression)) return false
        if (!expression && query.search && !`${book.title} ${book.authors.join(' ')}`.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())) return false
        if (query.shelfId && !matchesOrganization(book, 'shelf', query.shelfId)) return false
        if (query.categoryId && !(query.categoryId === 'none' ? !catalog?.categoryId : catalog?.categoryId && descendants.has(catalog.categoryId))) return false
        if (query.tagId && !matchesOrganization(book, 'tag', query.tagId)) return false
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
    async createOrganization(kind: ClientOrganization['items'][number]['kind'], name: string, parentId: string | null = null) {
      const current = await repository.getOrganization(scope.vaultId)
      const now = Date.now()
      const item = { id: localRecordId(), kind, name, parentId, pinned: false, hidden: false, sortOrder: Math.max(-1, ...current.items.filter((entry) => entry.kind === kind).map((entry) => entry.sortOrder)) + 1, createdAt: now, updatedAt: now }
      await repository.saveOrganization(scope.vaultId, { ...current, items: [...current.items, item] }, current.version)
      return item
    },
    async updateOrganization(kind: ClientOrganization['items'][number]['kind'], id: string, patch: Partial<Pick<ClientOrganization['items'][number], 'name' | 'parentId' | 'pinned' | 'hidden'>>) {
      const current = await repository.getOrganization(scope.vaultId)
      const item = current.items.find((entry) => entry.kind === kind && entry.id === id)
      if (!item) throw new LocalLibraryError('conflict', 'Organization no longer exists')
      const next = { ...item, ...patch, updatedAt: Date.now() }
      await repository.saveOrganization(scope.vaultId, { ...current, items: current.items.map((entry) => entry.id === id ? next : entry) }, current.version)
      return next
    },
    async deleteOrganization(kind: ClientOrganization['items'][number]['kind'], id: string) {
      const current = await repository.getOrganization(scope.vaultId)
      if (!current.items.some((entry) => entry.id === id && entry.kind === kind)) throw new LocalLibraryError('conflict', 'Organization no longer exists')
      const removed = new Set([id])
      if (kind === 'category') for (let previous = -1; previous !== removed.size;) {
        previous = removed.size
        for (const entry of current.items) if (entry.kind === 'category' && entry.parentId && removed.has(entry.parentId)) removed.add(entry.id)
      }
      await repository.saveOrganization(scope.vaultId, { ...current, items: current.items.filter((entry) => !removed.has(entry.id)) }, current.version)
    },
    /**
     * Remember the tree the user is looking at, so a device book can be filed
     * under nodes that only the server can enumerate.
     */
    async mirrorOrganization(items: readonly ClientOrganization['items'][number][]) {
      await repository.mirrorOrganization(scope.vaultId, items)
    },
    async reorderOrganization(kind: ClientOrganization['items'][number]['kind'], orderedIds: string[]) {
      const current = await repository.getOrganization(scope.vaultId)
      const requested = new Set(orderedIds)
      if (requested.size !== orderedIds.length || orderedIds.some((id) => !current.items.some((entry) => entry.kind === kind && entry.id === id))) throw new LocalLibraryError('invalid-input', 'Invalid organization order')
      const entries = current.items.filter((entry) => entry.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      let index = 0
      const order = entries.map((entry) => requested.has(entry.id) ? orderedIds[index++]! : entry.id)
      const ranks = new Map(order.map((id, rank) => [id, rank]))
      await repository.saveOrganization(scope.vaultId, { ...current, items: current.items.map((entry) => entry.kind === kind ? { ...entry, sortOrder: ranks.get(entry.id)!, updatedAt: Date.now() } : entry) }, current.version)
    },
  }
}
