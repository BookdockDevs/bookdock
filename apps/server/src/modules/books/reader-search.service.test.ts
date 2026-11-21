import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getReaderManifest, readReaderSearchEntry } from './reader-content.service'
import { createReaderSearchStream, createScanTimeoutBudget, reserveReaderSearch, toReaderSearchError } from './reader-search.service'

vi.mock('./reader-content.service', () => ({
  getReaderManifest: vi.fn(),
  readReaderSearchEntry: vi.fn(),
}))

const book = { id: 'book-1', revisionId: 'revision-1', filePath: 'book.epub', format: 'epub' }
const request = {
  revisionId: 'revision-1', query: 'needle', mode: 'contains' as const, matchCase: false,
  chineseConversion: 'off' as const, replacements: [],
}

function stream(signal = new AbortController().signal, overrides: Partial<typeof request> = {}) {
  const acquired = reserveReaderSearch()
  expect(acquired).toBe(true)
  const result = createReaderSearchStream(book, { ...request, ...overrides }, signal)
  return new Response(result).text().then((text) => text.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>))
}

describe('reader full-book search service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getReaderManifest).mockResolvedValue({
      spine: [
        { path: 'chapter-1.xhtml', mediaType: 'application/xhtml+xml', linear: true },
        { path: 'chapter-2.xhtml', mediaType: 'application/xhtml+xml', linear: true },
      ],
    } as Awaited<ReturnType<typeof getReaderManifest>>)
  })

  it('streams summary hits and scan progress without sending chapter text', async () => {
    vi.mocked(readReaderSearchEntry).mockImplementation(async (_book, path) => ({
      path, mediaType: 'application/xhtml+xml', data: Buffer.from(`<html><body><p>${path.includes('1') ? 'needle in first' : 'needle in second'}</p></body></html>`),
    }))
    const events = await stream()
    expect(events[0]).toMatchObject({ type: 'batch', scanned: 0, total: 2, hits: [{ sectionIndex: 0, start: 0, end: 6, excerpt: { match: 'needle' } }] })
    expect(events.some((event) => event.type === 'batch' && event.scanned === 1 && event.hits instanceof Array && event.hits.length === 0)).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'complete', scanned: 2, total: 2 })
    expect(JSON.stringify(events)).not.toContain('needle in first')
  })

  it('marks results truncated only after observing a hit beyond the result cap', async () => {
    vi.mocked(readReaderSearchEntry).mockResolvedValue({
      path: 'chapter-1.xhtml', mediaType: 'application/xhtml+xml', data: Buffer.from(`<html><body><p>${'needle '.repeat(2001)}</p></body></html>`),
    })
    const events = await stream()
    const count = events.reduce((total, event) => total + (event.type === 'batch' && Array.isArray(event.hits) ? event.hits.length : 0), 0)
    expect(count).toBe(2000)
    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'truncated' })
  })

  it('does not mark exactly 2,000 final results truncated', async () => {
    vi.mocked(readReaderSearchEntry)
      .mockResolvedValueOnce({ path: 'chapter-1.xhtml', mediaType: 'application/xhtml+xml', data: Buffer.from(`<html><body><p>${'needle '.repeat(2000)}</p></body></html>`) })
      .mockResolvedValueOnce({ path: 'chapter-2.xhtml', mediaType: 'application/xhtml+xml', data: Buffer.from('<html><body><p>no match</p></body></html>') })
    const events = await stream()
    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'complete', scanned: 2 })
  })

  it('continues after a chapter failure and reports a partial result set', async () => {
    vi.mocked(readReaderSearchEntry)
      .mockRejectedValueOnce(new Error('chapter unavailable'))
      .mockResolvedValueOnce({ path: 'chapter-2.xhtml', mediaType: 'application/xhtml+xml', data: Buffer.from('<html><body><p>needle</p></body></html>') })
    const events = await stream()
    expect(events.some((event) => event.type === 'batch' && event.hits instanceof Array && event.hits.length === 1)).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'partial', scanned: 2, total: 2 })
  })

  it('emits a canceled terminal event before scanning when the consumer aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const events = await stream(controller.signal)
    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'canceled', scanned: 0 })
    expect(readReaderSearchEntry).not.toHaveBeenCalled()
  })

  it('maps worker scan errors to user-facing codes by search mode', () => {
    expect(toReaderSearchError('regex', 'regex-timeout')).toBe('regex-timeout')
    expect(toReaderSearchError('contains', 'regex-timeout')).toBe('chapter-timeout')
    expect(toReaderSearchError('regex', 'regex-failed')).toBe('regex-failed')
    expect(toReaderSearchError('contains', 'regex-failed')).toBeNull()
  })

  it('exhausts the scan-timeout budget only after the accumulated cost', () => {
    const budget = createScanTimeoutBudget(30_000)
    budget.consume(10_000)
    budget.consume(10_000)
    expect(budget.exhausted()).toBe(false)
    budget.consume(10_000)
    expect(budget.exhausted()).toBe(true)
    expect(createScanTimeoutBudget(30_000).exhausted()).toBe(false)
  })

  it('continues scanning after a timed-out chapter and reports the scan error', async () => {
    vi.mocked(readReaderSearchEntry)
      .mockResolvedValueOnce({ path: 'chapter-1.xhtml', mediaType: 'application/xhtml+xml', data: Buffer.from(`<html><body><p>${'a'.repeat(200_000)}!</p></body></html>`) })
      .mockResolvedValueOnce({ path: 'chapter-2.xhtml', mediaType: 'application/xhtml+xml', data: Buffer.from('<html><body><p>ab needle later</p></body></html>') })
    const events = await stream(undefined, { mode: 'regex', query: '(a+)+b', matchCase: true })
    expect(events.some((event) => event.type === 'batch' && event.hits instanceof Array && event.hits.length === 1)).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'partial', scanned: 2, total: 2, error: 'regex-timeout' })
  }, 15_000)

  it('stops and releases the slot once the scan-timeout budget is exhausted', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(getReaderManifest).mockResolvedValue({
        // 12 chapters so the book outlives the 30s budget (10 × 3s regex
        // timeouts): the stream must stop at chapter 10, not scan the rest.
        spine: Array.from({ length: 12 }, (_, index) => ({ path: `chapter-${index}.xhtml`, mediaType: 'application/xhtml+xml', linear: true })),
      } as Awaited<ReturnType<typeof getReaderManifest>>)
      vi.mocked(readReaderSearchEntry).mockImplementation(async (_book, path) => ({
        path, mediaType: 'application/xhtml+xml', data: Buffer.from(`<html><body><p>${'a'.repeat(200_000)}!</p></body></html>`),
      }))
      expect(reserveReaderSearch()).toBe(true)
      const result = createReaderSearchStream(book, { ...request, mode: 'regex', query: '(a+)+b', matchCase: true }, new AbortController().signal)
      const pending = new Response(result).text()
        .then((text) => text.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>))
      for (let advance = 0; advance < 5; advance++) await vi.advanceTimersByTimeAsync(15_000)
      const events = await pending
      // The chapter that trips the budget is counted in the final progress
      // (scanned would be 9 without the count and 12 without the budget).
      expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'partial', scanned: 10, total: 12, error: 'regex-timeout' })
      expect(reserveReaderSearch()).toBe(true)
    } finally {
      vi.useRealTimers()
      const controller = new AbortController()
      controller.abort()
      await new Response(createReaderSearchStream(book, request, controller.signal)).text()
    }
  })
})
