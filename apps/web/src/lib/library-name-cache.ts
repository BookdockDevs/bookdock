import type { Category, LibraryListItem, LibraryTag, ShelfListItem, TagListItem } from '@bookdock/shared'

const STORAGE_PREFIX = 'bd-library-names:v1:'
const CACHE_VERSION = 1
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_LIBRARIES = 20
const MAX_TAXONOMY_ITEMS = 500
const MAX_SNAPSHOT_CHARS = 160_000

interface NavigationName {
  id: string
  name: string
  parentId?: string | null
}

interface LibraryNames {
  id: string
  type: 'private' | 'shared'
  name: string
}

interface LibraryNameSnapshot {
  version: number
  savedAt: number
  libraries: LibraryNames[]
  categories: Record<string, { savedAt: number; items: NavigationName[] }>
  tags: Record<string, { savedAt: number; items: NavigationName[] }>
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}`
}

function isNameList(value: unknown): value is NavigationName[] {
  return Array.isArray(value) && value.length <= MAX_TAXONOMY_ITEMS && value.every((item) =>
    item && typeof item === 'object' && typeof item.id === 'string' && item.id.length <= 200
    && typeof item.name === 'string' && item.name.length <= 500
    && (item.parentId === undefined || item.parentId === null || (typeof item.parentId === 'string' && item.parentId.length <= 200)),
  )
}

function isScopedNameMap(value: unknown): value is Record<string, { savedAt: number; items: NavigationName[] }> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).length <= MAX_LIBRARIES + 1
    && Object.entries(value).every(([scope, entry]) => scope.length <= 200
      && !!entry && typeof entry === 'object' && typeof entry.savedAt === 'number'
      && Number.isFinite(entry.savedAt) && entry.savedAt <= Date.now()
      && Date.now() - entry.savedAt <= MAX_AGE_MS && isNameList(entry.items))
}

function readSnapshot(userId: string): LibraryNameSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw || raw.length > MAX_SNAPSHOT_CHARS) {
      if (raw) window.localStorage.removeItem(storageKey(userId))
      return null
    }
    const value = JSON.parse(raw) as Partial<LibraryNameSnapshot>
    if (value.version !== CACHE_VERSION || typeof value.savedAt !== 'number'
      || !Number.isFinite(value.savedAt) || value.savedAt > Date.now() || Date.now() - value.savedAt > MAX_AGE_MS
      || !Array.isArray(value.libraries) || !isScopedNameMap(value.categories) || !isScopedNameMap(value.tags)) {
      window.localStorage.removeItem(storageKey(userId))
      return null
    }
    const libraries = value.libraries.filter((library): library is LibraryNames =>
      !!library && typeof library.id === 'string' && library.id.length <= 200
      && (library.type === 'private' || library.type === 'shared')
      && typeof library.name === 'string' && library.name.length <= 500,
    ).slice(0, MAX_LIBRARIES)
    return { version: CACHE_VERSION, savedAt: value.savedAt, libraries, categories: value.categories, tags: value.tags }
  } catch {
    return null
  }
}

function writeSnapshot(userId: string, update: (snapshot: LibraryNameSnapshot) => LibraryNameSnapshot): void {
  if (typeof window === 'undefined' || !userId) return
  try {
    const current = readSnapshot(userId) ?? { version: CACHE_VERSION, savedAt: Date.now(), libraries: [], categories: {}, tags: {} }
    const next = update(current)
    next.savedAt = Date.now()
    next.libraries = next.libraries.slice(0, MAX_LIBRARIES)
    const raw = JSON.stringify(next)
    if (raw.length <= MAX_SNAPSHOT_CHARS) window.localStorage.setItem(storageKey(userId), raw)
  } catch {
    // Local storage is an optional presentation cache.
  }
}

export function readLibraryNames(userId: string): LibraryNames[] {
  return readSnapshot(userId)?.libraries ?? []
}

export function readTaxonomyNames(userId: string, libraryId: string | null): { categories: NavigationName[]; tags: NavigationName[] } {
  const scope = libraryId ?? 'private'
  const snapshot = readSnapshot(userId)
  return {
    categories: snapshot?.categories[scope]?.items ?? [],
    tags: snapshot?.tags[scope]?.items ?? [],
  }
}

export function saveLibrariesSnapshot(userId: string, libraries: LibraryListItem[]): void {
  writeSnapshot(userId, (snapshot) => {
    const names = libraries.map(({ id, type, name }) => ({ id, type, name }))
    const visibleIds = new Set(names.map((library) => library.id))
    for (const scope of [...Object.keys(snapshot.categories), ...Object.keys(snapshot.tags)]) {
      if (scope !== 'private' && !visibleIds.has(scope)) {
        delete snapshot.categories[scope]
        delete snapshot.tags[scope]
      }
    }
    return { ...snapshot, libraries: names }
  })
}

export function saveShelvesSnapshot(userId: string, shelves: ShelfListItem[]): void {
  writeSnapshot(userId, (snapshot) => ({
    ...snapshot,
    categories: { ...snapshot.categories, private: { savedAt: Date.now(), items: shelves.map(({ id, name }) => ({ id, name })).slice(0, MAX_TAXONOMY_ITEMS) } },
  }))
}

export function saveTagsSnapshot(userId: string, tags: TagListItem[]): void {
  writeSnapshot(userId, (snapshot) => ({
    ...snapshot,
    tags: { ...snapshot.tags, private: { savedAt: Date.now(), items: tags.map(({ id, name }) => ({ id, name })).slice(0, MAX_TAXONOMY_ITEMS) } },
  }))
}

export function saveLibraryCategoriesSnapshot(userId: string, libraryId: string, categories: Category[]): void {
  writeSnapshot(userId, (snapshot) => ({
    ...snapshot,
    categories: { ...snapshot.categories, [libraryId]: { savedAt: Date.now(), items: categories.map(({ id, name, parentId }) => ({ id, name, parentId })).slice(0, MAX_TAXONOMY_ITEMS) } },
  }))
}

export function saveLibraryTagsSnapshot(userId: string, libraryId: string, tags: LibraryTag[]): void {
  writeSnapshot(userId, (snapshot) => ({
    ...snapshot,
    tags: { ...snapshot.tags, [libraryId]: { savedAt: Date.now(), items: tags.map(({ id, name }) => ({ id, name })).slice(0, MAX_TAXONOMY_ITEMS) } },
  }))
}

export function clearLibraryNamesSnapshot(userId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (userId) window.localStorage.removeItem(storageKey(userId))
    else {
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index)
        if (key?.startsWith(STORAGE_PREFIX)) window.localStorage.removeItem(key)
      }
    }
  } catch {
    // Local storage is an optional presentation cache.
  }
}
