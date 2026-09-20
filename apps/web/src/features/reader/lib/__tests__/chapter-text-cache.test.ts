import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  CHAPTER_TEXT_BUDGET_BYTES,
  chapterTextNamespaceFromUrl,
  makeChapterTextKey,
  withTextCache,
} from '../chapter-text-cache'

function fakeStore(overrides?: Partial<{
  get: (key: string) => Promise<{ key: string; text: string } | undefined>
  put: (key: string, text: string) => Promise<void>
  enforceBudget: (ns: string, budget: number) => Promise<void>
}>) {
  return {
    get: vi.fn(overrides?.get ?? (async () => undefined)),
    put: vi.fn(overrides?.put ?? (async () => {})),
    enforceBudget: vi.fn(overrides?.enforceBudget ?? (async () => {})),
  }
}

describe('chapterTextNamespaceFromUrl', () => {
  it('extracts bookId and version from the versioned content URL', () => {
    expect(chapterTextNamespaceFromUrl('/api/v1/books/b1/file?v=1700000000000')).toBe('b1|1700000000000')
  })

  it('returns null for any other URL shape (no cache rather than wrong namespace)', () => {
    expect(chapterTextNamespaceFromUrl('/api/v1/books/b1/file')).toBeNull()
    expect(chapterTextNamespaceFromUrl('https://cdn.example/books/b1/file?v=1')).toBeNull()
    expect(chapterTextNamespaceFromUrl('/api/v1/books/b1/cover')).toBeNull()
  })

  it('stops the version at a trailing hash or extra query param', () => {
    expect(chapterTextNamespaceFromUrl('/api/v1/books/b1/file?v=42&x=1')).toBe('b1|42')
  })
})

describe('makeChapterTextKey', () => {
  it('joins namespace and href with a separator', () => {
    expect(makeChapterTextKey('b1|42', 'OEBPS/c1.xhtml')).toBe('b1|42|OEBPS/c1.xhtml')
  })
})

describe('withTextCache', () => {
  // withTextCache fires put/enforceBudget without awaiting — a throwing
  // store must never surface as an unhandled rejection
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
  process.on('unhandledRejection', onUnhandled)
  afterAll(() => {
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toEqual([])
  })

  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('passes through untouched when the URL carries no version', async () => {
    const store = fakeStore()
    const load = vi.fn(async () => 'text')
    const wrapped = withTextCache(load, { namespace: null, store })
    expect(await wrapped('c1.xhtml')).toBe('text')
    expect(load).toHaveBeenCalledTimes(1)
    expect(store.get).not.toHaveBeenCalled()
    expect(store.put).not.toHaveBeenCalled()
  })

  it('serves a cache hit without touching the loader', async () => {
    const store = fakeStore({ get: async () => ({ key: 'ns|c1.xhtml', text: 'cached' }) })
    const load = vi.fn(async () => 'network')
    const wrapped = withTextCache(load, { namespace: 'ns', store })
    expect(await wrapped('c1.xhtml')).toBe('cached')
    expect(load).not.toHaveBeenCalled()
  })

  it('backfills and enforces the budget after a network read', async () => {
    const store = fakeStore()
    const load = vi.fn(async () => 'network')
    const wrapped = withTextCache(load, { namespace: 'ns', store })
    expect(await wrapped('c1.xhtml')).toBe('network')
    await flush()
    expect(store.put).toHaveBeenCalledWith('ns|c1.xhtml', 'network')
    expect(store.enforceBudget).toHaveBeenCalledWith('ns', CHAPTER_TEXT_BUDGET_BYTES)
  })

  it('never caches misses or missing entries', async () => {
    const store = fakeStore()
    const wrapped = withTextCache(async () => null, { namespace: 'ns', store })
    expect(await wrapped('c1.xhtml')).toBeNull()
    await flush()
    expect(store.put).not.toHaveBeenCalled()
  })

  it('degrades to the network when storage reads or writes throw', async () => {
    const store = fakeStore({
      get: async () => { throw new Error('idb down') },
      put: async () => { throw new Error('quota') },
    })
    const load = vi.fn(async () => 'network')
    const wrapped = withTextCache(load, { namespace: 'ns', store })
    expect(await wrapped('c1.xhtml')).toBe('network')
    expect(load).toHaveBeenCalledTimes(1)
    await flush()
    expect(store.put).toHaveBeenCalled()
  })

  it('propagates loader failures without caching them', async () => {
    const store = fakeStore()
    const wrapped = withTextCache(async () => { throw new Error('timeout') }, { namespace: 'ns', store })
    await expect(wrapped('c1.xhtml')).rejects.toThrow('timeout')
    await flush()
    expect(store.put).not.toHaveBeenCalled()
    expect(store.enforceBudget).not.toHaveBeenCalled()
  })
})
