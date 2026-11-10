import type { ClientBook, ClientCatalogEntry, ClientCategoryView, ClientLibraryBookView, ClientLibraryDetailView, ClientOrganization, ClientReadingState, ClientTaxonomyView, ViewSettings } from '@bookdock/shared'
import { clientPresetBindingSchema } from '@bookdock/shared'

export function localCatalogBookView(book: ClientCatalogEntry['book'], state: ClientReadingState | null, organization: ClientOrganization): ClientLibraryBookView {
  const catalog = book.catalog
  const shelf = organization.items.find((item) => item.kind === 'shelf' && item.id === catalog?.shelfId)
  const category = organization.items.find((item) => item.kind === 'category' && item.id === catalog?.categoryId)
  const tags = organization.items.filter((item) => item.kind === 'tag' && catalog?.tagIds?.includes(item.id))
  let hiddenCategory = category?.hidden ? category : undefined
  let ancestor = category
  const seen = new Set<string>()
  while (ancestor?.parentId && !seen.has(ancestor.id)) {
    seen.add(ancestor.id)
    ancestor = organization.items.find((item) => item.id === ancestor!.parentId && item.kind === 'category')
    if (ancestor?.hidden) hiddenCategory = ancestor
  }
  const hiddenTag = tags.find((item) => item.hidden)
  const hiddenReason = catalog?.hidden ? 'direct' : shelf?.hidden ? 'shelf' : hiddenCategory ? 'category' : hiddenTag ? 'tag' : null
  return {
    ref: book.ref, id: book.ref.bookId, title: book.title, author: book.authors[0] ?? '', authors: book.authors,
    format: book.format, coverKey: null, size: book.size,
    readStatus: state?.readStatus ?? 'reading', progress: state?.fraction === null || !state ? null : state.fraction * 100,
    pinnedAt: catalog?.pinnedAt, lastReadAt: state?.lastReadAt ?? null,
    deletedAt: book.deletedAt ?? null, createdAt: book.createdAt, updatedAt: book.updatedAt, clientVersion: book.version ?? undefined,
    shelfId: catalog?.shelfId ?? null, shelfName: shelf?.name, categoryId: catalog?.categoryId ?? null, categoryName: category?.name,
    tags: tags.map((item) => item.name), coverPaletteId: catalog?.coverPaletteId,
    coverPaletteKey: JSON.stringify([book.ref.scope, book.ref.bookId]),
    hidden: catalog?.hidden ?? false, effectiveHidden: hiddenReason !== null, hiddenReason,
    hiddenVia: { ...(shelf?.hidden ? { shelfName: shelf.name } : {}), ...(hiddenCategory ? { categoryName: hiddenCategory.name } : {}), ...(hiddenTag ? { tagNames: tags.filter((tag) => tag.hidden).map((tag) => tag.name) } : {}) },
    sourceUnavailable: book.availability !== 'available',
  }
}

export function localCatalogDetailView(book: ClientCatalogEntry['book'], state: ClientReadingState | null, organization: ClientOrganization, settings: Record<string, unknown>): ClientLibraryDetailView {
  return {
    ...localCatalogBookView(book, state, organization),
    revisionId: book.content?.contentId,
    meta: { ...(book.catalog?.metadata ? { bookmeta: book.catalog.metadata } : {}), ...(book.textSource?.ruleSelection ? { customTocPatterns: book.textSource.ruleSelection.patterns ?? undefined, tocRuleId: book.textSource.ruleSelection.patterns ? 'custom' : undefined, tocRuleLabel: book.textSource.ruleSelection.label ?? undefined, tocRuleAuto: book.textSource.ruleSelection.auto } : {}), ...(book.textSource ? { wordCount: book.textSource.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0) } : {}) },
    tagIds: book.catalog?.tagIds ?? [],
    readerSettings: { viewSettings: settings.viewSettings as ViewSettings | undefined },
    clientPresetBinding: clientPresetBindingSchema.nullable().parse(settings.presetBinding ?? null),
  }
}

export function localTaxonomyViews(snapshot: { books: Array<{ book: ClientBook; state: ClientReadingState | null }>; organization: ClientOrganization }, showHidden: boolean): { shelves: ClientTaxonomyView[]; tags: ClientTaxonomyView[]; categories: ClientCategoryView[] } {
  const { organization } = snapshot
  const booksById = new Map(snapshot.books.map(({ book }) => [book.ref.bookId, book]))
  const rows = snapshot.books.filter(({ book }) => book.deletedAt == null && !book.catalogRemoved).map(({ book, state }) => localCatalogBookView(book, state, organization)).filter((row) => showHidden || !row.effectiveHidden)
  const hiddenIds = new Set(organization.items.filter((item) => item.hidden).map((item) => item.id))
  for (let previous = -1; previous !== hiddenIds.size;) {
    previous = hiddenIds.size
    for (const item of organization.items) if (item.parentId && hiddenIds.has(item.parentId)) hiddenIds.add(item.id)
  }
  const visible = organization.items.filter((item) => showHidden || !hiddenIds.has(item.id)).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  const shelves = visible.filter((item) => item.kind === 'shelf').map((item) => ({ ...item, bookCount: rows.filter((row) => row.shelfId === item.id).length }))
  const tags = visible.filter((item) => item.kind === 'tag').map((item) => ({ ...item, bookCount: rows.filter((row) => booksById.get(row.id)?.catalog?.tagIds?.includes(item.id)).length }))
  const categories = visible.filter((item) => item.kind === 'category').map((item) => {
    const children = new Set([item.id])
    for (let previous = -1; previous !== children.size;) {
      previous = children.size
      for (const child of organization.items) if (child.kind === 'category' && child.parentId && children.has(child.parentId)) children.add(child.id)
    }
    return { ...item, bookCount: rows.filter((row) => row.categoryId === item.id).length, subtreeBookCount: rows.filter((row) => row.categoryId && children.has(row.categoryId)).length }
  })
  return { shelves, tags, categories }
}

export interface DeviceMembershipCounts {
  shelves: Map<string, number>
  categories: Map<string, number>
  tags: Map<string, number>
  /** Books the trash is not holding. */
  active: number
  /** Books the trash is holding. */
  trash: number
  /** Active books with no shelf and no category. */
  unshelved: number
  uncategorized: number
}

/**
 * Membership counts for the device half, read straight from the books.
 *
 * A device book's shelf/category/tag id points at whichever tree is in play —
 * the server's when there is a session — so the vault cannot enumerate that
 * tree. It can only say how many of its own books carry each id, which is what
 * the sidebar needs to keep its numbers honest. Hidden books are counted: the
 * number answers "how many books are filed here", and hiding is a filter the
 * reader turns on separately.
 */
export function deviceMembershipCounts(snapshot: { books: Array<{ book: ClientBook }> }): DeviceMembershipCounts {
  const shelves = new Map<string, number>()
  const categories = new Map<string, number>()
  const tags = new Map<string, number>()
  const bump = (map: Map<string, number>, id: string | null | undefined) => {
    if (id) map.set(id, (map.get(id) ?? 0) + 1)
  }
  let active = 0
  let trash = 0
  let unshelved = 0
  let uncategorized = 0
  for (const { book } of snapshot.books) {
    if (book.catalogRemoved) continue
    if (book.deletedAt != null) {
      trash++
      continue
    }
    active++
    if (!book.catalog?.shelfId) unshelved++
    if (!book.catalog?.categoryId) uncategorized++
    bump(shelves, book.catalog?.shelfId)
    bump(categories, book.catalog?.categoryId)
    for (const id of book.catalog?.tagIds ?? []) bump(tags, id)
  }
  return { shelves, categories, tags, active, trash, unshelved, uncategorized }
}
