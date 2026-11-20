import type { ClientBook, ClientCatalogEntry, ClientCategoryView, ClientLibraryBookView, ClientLibraryDetailView, ClientOrganization, ClientReadingState, ClientTaxonomyView, ViewSettings } from '@bookdock/shared'
import { classificationValueKey, clientPresetBindingSchema, readerBookSettingsSchema } from '@bookdock/shared'

/** The stored preference row for one value, if the sidebar has ever touched it. */
function valueState(organization: ClientOrganization, kind: 'category' | 'tag', value: string) {
  return organization.valueState.find((state) => state.kind === kind && state.value === value)
}

/**
 * The path a book's category names, or null. A two-level path hides through
 * either end: hiding the root hides its whole branch, which is why a leaf is
 * checked against its own key and its root's.
 */
function categoryHidden(organization: ClientOrganization, path: string[] | null): boolean {
  if (!path) return false
  if (valueState(organization, 'category', classificationValueKey('category', path))?.hidden) return true
  return path.length > 1 && Boolean(valueState(organization, 'category', classificationValueKey('category', [path[0]!]))?.hidden)
}

export function localCatalogBookView(book: ClientCatalogEntry['book'], state: ClientReadingState | null, organization: ClientOrganization): ClientLibraryBookView {
  const catalog = book.catalog
  const shelf = organization.shelves.find((entry) => entry.id === catalog?.shelfId)
  const path = catalog?.categoryPath ?? null
  const tagNames = catalog?.tags ?? []
  const hiddenTags = tagNames.filter((name) => valueState(organization, 'tag', name)?.hidden)
  const hiddenCategory = categoryHidden(organization, path)
  const hiddenReason = catalog?.hidden ? 'direct' : shelf?.hidden ? 'shelf' : hiddenCategory ? 'category' : hiddenTags.length > 0 ? 'tag' : null
  return {
    ref: book.ref, id: book.ref.bookId, title: book.title, author: book.authors[0] ?? '', authors: book.authors,
    format: book.format, coverKey: null, size: book.size,
    readStatus: state?.readStatus ?? 'reading', progress: state?.fraction === null || !state ? null : state.fraction * 100,
    pinnedAt: catalog?.pinnedAt, lastReadAt: state?.lastReadAt ?? null,
    deletedAt: book.deletedAt ?? null, createdAt: book.createdAt, updatedAt: book.updatedAt, clientVersion: book.version ?? undefined,
    shelfId: catalog?.shelfId ?? null, shelfName: shelf?.name,
    categoryPath: path, categoryName: path ? path.join(' / ') : null,
    tags: tagNames, coverPaletteId: catalog?.coverPaletteId,
    coverPaletteKey: JSON.stringify([book.ref.scope, book.ref.bookId]),
    hidden: catalog?.hidden ?? false, effectiveHidden: hiddenReason !== null, hiddenReason,
    hiddenVia: {
      ...(shelf?.hidden ? { shelfName: shelf.name } : {}),
      ...(hiddenCategory && path ? { categoryName: path.join(' / ') } : {}),
      ...(hiddenTags.length > 0 ? { tagNames: hiddenTags } : {}),
    },
    sourceUnavailable: book.availability !== 'available',
  }
}

export function localCatalogDetailView(book: ClientCatalogEntry['book'], state: ClientReadingState | null, organization: ClientOrganization, settings: Record<string, unknown>): ClientLibraryDetailView {
  return {
    ...localCatalogBookView(book, state, organization),
    revisionId: book.content?.contentId,
    meta: { ...(book.catalog?.metadata ? { bookmeta: book.catalog.metadata } : {}), ...(book.textSource?.ruleSelection ? { customTocPatterns: book.textSource.ruleSelection.patterns ?? undefined, tocRuleId: book.textSource.ruleSelection.patterns ? 'custom' : undefined, tocRuleLabel: book.textSource.ruleSelection.label ?? undefined, tocRuleAuto: book.textSource.ruleSelection.auto } : {}), ...(book.textSource ? { wordCount: book.textSource.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0) } : {}) },
    tags: book.catalog?.tags ?? [],
    readerSettings: {
      themeSelection: readerBookSettingsSchema.shape.themeSelection.catch(undefined).parse(settings.themeSelection),
      viewSettings: settings.viewSettings as ViewSettings | undefined,
      readingThemeId: readerBookSettingsSchema.shape.readingThemeId.catch(undefined).parse(settings.readingThemeId),
    },
    clientPresetBinding: clientPresetBindingSchema.nullable().parse(settings.presetBinding ?? null),
  }
}

/**
 * Sidebar taxonomy for the device half, aggregated from what the books carry.
 *
 * Nothing here is a stored row. A category exists because some book names its
 * path, a tag because some book carries the name, and a shelf because the vault
 * still has the shelf row. What the vault does store is the sidebar's opinion of
 * each value — hidden, pinned, manual order — which is why an unused value
 * leaves the tree while its preferences stay behind.
 */
export function localTaxonomyViews(snapshot: { books: Array<{ book: ClientBook; state: ClientReadingState | null }>; organization: ClientOrganization }, showHidden: boolean): { shelves: ClientTaxonomyView[]; tags: ClientTaxonomyView[]; categories: ClientCategoryView[] } {
  const { organization } = snapshot
  const rows = snapshot.books
    .filter(({ book }) => book.deletedAt == null && !book.catalogRemoved)
    .map(({ book, state }) => localCatalogBookView(book, state, organization))
    .filter((row) => showHidden || !row.effectiveHidden)
  const shelves = organization.shelves
    .filter((shelf) => showHidden || !shelf.hidden)
    .map((shelf) => ({ ...shelf, bookCount: rows.filter((row) => row.shelfId === shelf.id).length }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

  const tagCounts = new Map<string, number>()
  for (const row of rows) for (const name of row.tags ?? []) tagCounts.set(name, (tagCounts.get(name) ?? 0) + 1)
  const tags = [...tagCounts].flatMap(([name, bookCount]) => {
    const state = valueState(organization, 'tag', name)
    if (!showHidden && state?.hidden) return []
    return [{
      id: name, name, bookCount,
      sortOrder: state?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      pinned: state?.pinned ?? false,
      hidden: state?.hidden ?? false,
      createdAt: state?.createdAt ?? 0,
      updatedAt: state?.updatedAt ?? 0,
    }]
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

  const direct = new Map<string, number>()
  const children = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const path = row.categoryPath
    if (!path || path.length === 0) continue
    if (path.length === 1) {
      direct.set(path[0]!, (direct.get(path[0]!) ?? 0) + 1)
      if (!children.has(path[0]!)) children.set(path[0]!, new Map())
      continue
    }
    const bucket = children.get(path[0]!) ?? new Map<string, number>()
    bucket.set(path[1]!, (bucket.get(path[1]!) ?? 0) + 1)
    children.set(path[0]!, bucket)
  }
  const categories: ClientCategoryView[] = []
  const node = (path: string[], bookCount: number, subtreeBookCount: number): ClientCategoryView => {
    const id = classificationValueKey('category', path)
    const state = valueState(organization, 'category', id)
    return {
      id, path, name: path[path.length - 1]!,
      parentId: path.length === 1 ? null : classificationValueKey('category', path.slice(0, -1)),
      sortOrder: state?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      pinned: state?.pinned ?? false,
      hidden: state?.hidden ?? false,
      createdAt: state?.createdAt ?? 0,
      updatedAt: state?.updatedAt ?? 0,
      bookCount, subtreeBookCount,
    }
  }
  for (const [root, leafCounts] of children) {
    const rootState = valueState(organization, 'category', classificationValueKey('category', [root]))
    if (!showHidden && rootState?.hidden) continue
    const rootDirect = direct.get(root) ?? 0
    let subtree = rootDirect
    const leafNodes: ClientCategoryView[] = []
    for (const [leaf, count] of leafCounts) {
      const path = [root, leaf]
      if (!showHidden && valueState(organization, 'category', classificationValueKey('category', path))?.hidden) continue
      subtree += count
      leafNodes.push(node(path, count, count))
    }
    categories.push(node([root], rootDirect, subtree), ...leafNodes)
  }
  categories.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
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
 * Categories are counted by their canonical value key and tags by their name,
 * which is exactly how the sidebar addresses them, so the numbers line up with
 * the server's aggregates without either side enumerating the other's tree.
 * Hidden books are counted: the number answers "how many books are filed here",
 * and hiding is a filter the reader turns on separately.
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
    const path = book.catalog?.categoryPath ?? null
    if (!book.catalog?.shelfId) unshelved++
    if (!path) uncategorized++
    bump(shelves, book.catalog?.shelfId)
    if (path) {
      bump(categories, classificationValueKey('category', path))
      if (path.length > 1) bump(categories, classificationValueKey('category', [path[0]!]))
    }
    for (const name of book.catalog?.tags ?? []) bump(tags, name)
  }
  return { shelves, categories, tags, active, trash, unshelved, uncategorized }
}

/** Add device book counts onto a server-owned flat taxonomy (shelves or tags). */
export function overlayTaxonomyDeviceCounts<T extends { id: string; bookCount: number }>(
  items: readonly T[],
  counts: ReadonlyMap<string, number> | undefined,
): T[] {
  if (!counts || counts.size === 0) return items as T[]
  return items.map((item) => {
    const extra = counts.get(item.id)
    return extra ? { ...item, bookCount: item.bookCount + extra } : item
  })
}

/**
 * Add device book counts onto a server-owned category tree, rolling leaf
 * additions up through parent `subtreeBookCount` values.
 */
export function overlayCategoryDeviceCounts<T extends { id: string; parentId: string | null; bookCount: number; subtreeBookCount: number }>(
  categories: readonly T[],
  counts: ReadonlyMap<string, number> | undefined,
): T[] {
  if (!counts || counts.size === 0) return categories as T[]
  const byId = new Map(categories.map((item) => [item.id, item]))
  const subtree = new Map<string, number>()
  for (const [id, count] of counts) {
    if (!count) continue
    const seen = new Set<string>()
    let current: string | null = id
    while (current && !seen.has(current)) {
      seen.add(current)
      subtree.set(current, (subtree.get(current) ?? 0) + count)
      current = byId.get(current)?.parentId ?? null
    }
  }
  return categories.map((item) => {
    const direct = counts.get(item.id) ?? 0
    const rolled = subtree.get(item.id) ?? 0
    return direct || rolled
      ? { ...item, bookCount: item.bookCount + direct, subtreeBookCount: item.subtreeBookCount + rolled }
      : item
  })
}
