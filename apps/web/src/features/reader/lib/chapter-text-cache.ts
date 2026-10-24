import { idbChapterTextStore, READER_CONTENT_BUDGET_BYTES, type ChapterTextStore } from './idb-chapter-store'

// EPUB chapter XHTML text is stable per content version, but the in-memory
// text memo and the parse cache die with the page — reopening a book re-pays
// one Range fetch per chapter. This persists raw chapter text in IndexedDB so
// re-opens read from disk. App-level on purpose: the browser HTTP cache is
// unusable here because Chrome stalls 300-400ms reading back multi-MB cached
// Range entries. TXT books (offset-sliced files) are out of scope.

export const CHAPTER_TEXT_BUDGET_BYTES = READER_CONTENT_BUDGET_BYTES

export interface ChapterTextEntry {
  key: string
  text: string
}

// The version rides in the key namespace, so any re-conversion or revision
// switch strands the old generation's entries; the store enforces the global
// reader-content LRU across books.
export function makeChapterTextKey(namespace: string, href: string): string {
  return `${namespace}|${href}`
}

// `/api/v1/books/{id}/file?reader=1&revisionId={rev}&v={updatedAt}`. Revision
// wins over the display timestamp; an account scope prefixes the key so one
// viewer's cache can never answer another's read.
// Returns null for any other URL shape — no cache rather than a wrong-namespace cache.
export function chapterTextNamespaceFromUrl(url: string, accountScope?: string): string | null {
  const match = /^\/api\/v1\/books\/([^/]+)\/file\?(.*)$/.exec(url)
  if (!match) return null
  const id = match[1]
  const params = new URLSearchParams(match[2])
  const version = params.get('revisionId') || params.get('v')
  if (!id || !version) return null
  const namespace = `${id}|${version}`
  return accountScope ? `${accountScope}|${namespace}` : namespace
}

export interface WithTextCacheOptions {
  namespace: string | null
  store?: ChapterTextStore | null
  budgetBytes?: number
  canWrite?: () => boolean
}

// Wraps the raw (uncached) loader below the in-memory memo:
// namespace-less (no version in URL) and storage failures degrade to a plain
// network read; failures are never cached at any level.
export function withTextCache(
  load: (href: string) => Promise<string | null>,
  { namespace, store = idbChapterTextStore, budgetBytes = CHAPTER_TEXT_BUDGET_BYTES, canWrite }: WithTextCacheOptions,
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
    if (text && (!canWrite || canWrite())) {
      void (async () => {
        await (canWrite ? store.put(key, text, canWrite) : store.put(key, text))
        await store.enforceBudget(namespace, budgetBytes)
      })().catch(() => {})
    }
    return text
  }
}
