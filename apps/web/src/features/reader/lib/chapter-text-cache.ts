import { idbChapterTextStore, type ChapterTextStore } from './idb-chapter-store'

// EPUB chapter XHTML text is stable per content version, but the in-memory
// text memo and the parse cache die with the page — reopening a book re-pays
// one Range fetch per chapter. This persists raw chapter text in IndexedDB so
// re-opens read from disk. App-level on purpose: the browser HTTP cache is
// unusable here because Chrome stalls 300-400ms reading back multi-MB cached
// Range entries. TXT books (offset-sliced files) are out of scope.

export const CHAPTER_TEXT_BUDGET_BYTES = 20 * 1024 * 1024

export interface ChapterTextEntry {
  key: string
  text: string
}

// The version rides in the key namespace (from the `?v=updatedAt` content
// URL), so any re-conversion or metadata edit strands the old generation's
// entries; each book's entries are capped by the store's per-namespace LRU.
export function makeChapterTextKey(namespace: string, href: string): string {
  return `${namespace}|${href}`
}

// `/api/v1/books/{id}/file?v={updatedAt}` -> `{id}|{updatedAt}`.
// Returns null for any other URL shape — no cache rather than a wrong-namespace cache.
export function chapterTextNamespaceFromUrl(url: string): string | null {
  const match = /^\/api\/v1\/books\/([^/]+)\/file\?v=([^&#]+)(?:[#&]|$)/.exec(url)
  if (!match) return null
  return `${match[1]}|${match[2]}`
}

export interface WithTextCacheOptions {
  namespace: string | null
  store?: ChapterTextStore | null
  budgetBytes?: number
}

// Wraps the raw (uncached) loader below the in-memory memo:
// namespace-less (no version in URL) and storage failures degrade to a plain
// network read; failures are never cached at any level.
export function withTextCache(
  load: (href: string) => Promise<string | null>,
  { namespace, store = idbChapterTextStore, budgetBytes = CHAPTER_TEXT_BUDGET_BYTES }: WithTextCacheOptions,
): (href: string) => Promise<string | null> {
  if (!namespace || !store) return load
  return async (href: string) => {
    const key = makeChapterTextKey(namespace, href)
    let hit: ChapterTextEntry | undefined
    try {
      hit = await store.get(key)
    } catch {
      // storage unavailable — network is the fallback
    }
    if (hit) return hit.text
    const text = await load(href)
    if (text) {
      store.put(key, text).catch(() => {})
      store.enforceBudget(namespace, budgetBytes).catch(() => {})
    }
    return text
  }
}
