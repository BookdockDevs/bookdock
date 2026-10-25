import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Readable } from 'node:stream'

import { errorHandler, AppError } from '../../middleware/error'
import readerContentRoutes from './reader-content.routes'
import { getActiveBook } from './books.service'
import { getReaderManifest, readReaderEntryForWeb, readReaderTextBatch } from './reader-content.service'
import { acquireReaderMedia } from './reader-media.service'

vi.mock('./books.service', () => ({
  getActiveBook: vi.fn(),
}))

vi.mock('./reader-content.service', () => ({
  getReaderManifest: vi.fn(),
  readReaderEntryForWeb: vi.fn(),
  readReaderTextBatch: vi.fn(),
  ReaderArchiveUnavailable: class ReaderArchiveUnavailable extends Error {},
  ReaderEntryLimitError: class ReaderEntryLimitError extends Error {},
}))

vi.mock('./reader-media.service', () => ({
  acquireReaderMedia: vi.fn(),
}))

function mediaLease(size: number, mediaType: string) {
  return {
    file: 'fixture', size, mediaType,
    createStream: vi.fn((range?: { start: number; end: number }) => Readable.from([
      Buffer.from('abcdef').subarray(range?.start ?? 0, (range?.end ?? 5) + 1),
    ])),
    release: vi.fn(async () => {}),
  }
}

const activeBook = {
  id: 'book-1',
  filePath: 'content/book-1.epub',
  format: 'epub',
  revisionId: 'revision-1',
  contentHash: 'content-hash-1',
}

function appFor(userId: string | null = 'reader-1') {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    if (userId) c.set('user', { id: userId, username: userId, role: 'user', avatarKey: null })
    return next()
  })
  app.route('/api/v1/books', readerContentRoutes)
  return app
}

describe('reader content route authorization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checks current read permission before consulting a warm content cache', async () => {
    vi.mocked(getActiveBook).mockRejectedValue(new AppError('FORBIDDEN', 'Book is not readable'))
    vi.mocked(getReaderManifest).mockResolvedValue({} as Awaited<ReturnType<typeof getReaderManifest>>)

    const response = await appFor().request('/api/v1/books/book-1/reader/manifest')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(getActiveBook).toHaveBeenCalledWith('reader-1', 'book-1', { showHidden: false })
    expect(getReaderManifest).not.toHaveBeenCalled()
  })

  it('rejects guests without the reader capability before resolving a book', async () => {
    const response = await appFor(null).request('/api/v1/books/book-1/reader/manifest')

    expect(response.status).toBe(403)
    expect(getActiveBook).not.toHaveBeenCalled()
    expect(getReaderManifest).not.toHaveBeenCalled()
  })

  it('rejects stale revision requests before reading an entry', async () => {
    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)

    const response = await appFor().request('/api/v1/books/book-1/reader/entry?revisionId=old-revision&path=OEBPS%2Ftext%2Fch1.xhtml')

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'READER_REVISION_CHANGED' } })
    expect(readReaderEntryForWeb).not.toHaveBeenCalled()
  })

  it('serves full and byte-range media responses with exact headers', async () => {
    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)
    const lease = mediaLease(6, 'video/mp4')
    vi.mocked(acquireReaderMedia).mockResolvedValue(lease)
    const url = '/api/v1/books/book-1/reader/media?revisionId=revision-1&path=OEBPS%2Fvideo%2Fv.mp4'
    const response = await appFor().request(url, { headers: { Range: 'bytes=2-4' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-range')).toBe('bytes 2-4/6')
    expect(response.headers.get('content-length')).toBe('3')
    expect(await response.text()).toBe('cde')
    expect(lease.createStream).toHaveBeenCalledWith({ start: 2, end: 4 })

    const oneByte = await appFor().request(url, { headers: { Range: 'bytes=3-3' } })
    expect(oneByte.status).toBe(206)
    expect(oneByte.headers.get('content-range')).toBe('bytes 3-3/6')
    expect(oneByte.headers.get('content-length')).toBe('1')
    expect(await oneByte.text()).toBe('d')

    const full = await appFor().request(url)
    expect(full.status).toBe(200)
    expect(full.headers.get('content-length')).toBe('6')
    expect(await full.text()).toBe('abcdef')
  })

  it.each(['bytes=4-', 'bytes=-2'])('resolves open and suffix range %s', async (range) => {
    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)
    const lease = mediaLease(6, 'audio/mpeg')
    vi.mocked(acquireReaderMedia).mockResolvedValue(lease)
    const response = await appFor().request('/api/v1/books/book-1/reader/media?revisionId=revision-1&path=a.mp3', { headers: { Range: range } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(range === 'bytes=4-' ? 'bytes 4-5/6' : 'bytes 4-5/6')
    expect(await response.text()).toBe('ef')
  })

  it('returns 416 for invalid media ranges and does not open a response stream', async () => {
    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)
    const lease = mediaLease(6, 'audio/mpeg')
    vi.mocked(acquireReaderMedia).mockResolvedValue(lease)
    const response = await appFor().request('/api/v1/books/book-1/reader/media?revisionId=revision-1&path=a.mp3', { headers: { Range: 'bytes=6-' } })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */6')
    expect(lease.createStream).not.toHaveBeenCalled()
    expect(lease.release).toHaveBeenCalledOnce()
  })

  it('rechecks authorization and revision before media cache access', async () => {
    vi.mocked(getActiveBook).mockRejectedValue(new AppError('FORBIDDEN', 'Book is not readable'))
    const denied = await appFor().request('/api/v1/books/book-1/reader/media?path=a.mp3')
    expect(denied.status).toBe(403)
    expect(acquireReaderMedia).not.toHaveBeenCalled()

    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)
    const stale = await appFor().request('/api/v1/books/book-1/reader/media?revisionId=rev-old&path=a.mp3')
    expect(stale.status).toBe(409)
    expect(acquireReaderMedia).not.toHaveBeenCalled()
  })

  it('serves HEAD metadata without opening a media transfer stream', async () => {
    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)
    const lease = mediaLease(6, 'audio/mpeg')
    vi.mocked(acquireReaderMedia).mockResolvedValue(lease)
    const response = await appFor().request('/api/v1/books/book-1/reader/media?revisionId=revision-1&path=a.mp3', { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('6')
    expect(lease.createStream).not.toHaveBeenCalled()
    expect(lease.release).toHaveBeenCalledOnce()
  })

  it('handles empty media files without creating an invalid file range', async () => {
    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)
    const lease = mediaLease(0, 'audio/mpeg')
    vi.mocked(acquireReaderMedia).mockResolvedValue(lease)
    const url = '/api/v1/books/book-1/reader/media?revisionId=revision-1&path=empty.mp3'
    const response = await appFor().request(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('0')
    expect(await response.text()).toBe('')
    const ranged = await appFor().request(url, { headers: { Range: 'bytes=0-' } })
    expect(ranged.status).toBe(416)
    expect(lease.createStream).not.toHaveBeenCalled()
    expect(lease.release).toHaveBeenCalledTimes(2)
  })

  it('allows a readable revision and returns a non-cacheable isolated raw entry', async () => {
    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)
    vi.mocked(readReaderEntryForWeb).mockResolvedValue({
      path: 'OEBPS/text/ch1.xhtml',
      mediaType: 'application/xhtml+xml',
      data: Buffer.from('<html/>'),
      resources: [],
    })

    const response = await appFor().request('/api/v1/books/book-1/reader/entry?revisionId=revision-1&path=OEBPS%2Ftext%2Fch1.xhtml')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: { text: '<html/>', resources: [] } })
    expect(getActiveBook).toHaveBeenCalledWith('reader-1', 'book-1', { showHidden: false })
  })

  it('serves EPUB media inline so download managers do not treat playback as a download', async () => {
    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)
    vi.mocked(readReaderEntryForWeb).mockResolvedValue({
      path: 'OEBPS/video/entry.mp4',
      mediaType: 'video/mp4',
      data: Buffer.from('video'),
      resources: [],
    })

    const response = await appFor().request('/api/v1/books/book-1/reader/entry?revisionId=revision-1&path=OEBPS%2Fvideo%2Fentry.mp4')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.arrayBuffer()).toEqual(Uint8Array.from(Buffer.from('video')).buffer)
  })

  it('returns bounded image layout hints with chapter markup in the same response', async () => {
    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)
    vi.mocked(readReaderEntryForWeb).mockResolvedValue({
      path: 'OEBPS/text/ch1.xhtml',
      mediaType: 'application/xhtml+xml',
      data: Buffer.from('<html><body><img src="../images/cover.png" width="640" height="480"/></body></html>'),
      resources: [{ path: 'OEBPS/images/cover.png', width: 640, height: 480 }],
    })

    const response = await appFor().request('/api/v1/books/book-1/reader/entry?revisionId=revision-1&path=OEBPS%2Ftext%2Fch1.xhtml')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { resources: [{ path: 'OEBPS/images/cover.png', width: 640, height: 480 }] },
    })
  })

  it('omits optional image dimensions when a clean-reading entry request opts out', async () => {
    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)
    vi.mocked(readReaderEntryForWeb).mockResolvedValue({
      path: 'OEBPS/text/ch1.xhtml', mediaType: 'application/xhtml+xml', data: Buffer.from('<html/>'), resources: [],
    })
    const response = await appFor().request('/api/v1/books/book-1/reader/entry?revisionId=revision-1&path=OEBPS%2Ftext%2Fch1.xhtml&includeResourceDimensions=false')
    expect(response.status).toBe(200)
    expect(readReaderEntryForWeb).toHaveBeenCalledWith(expect.anything(), 'OEBPS/text/ch1.xhtml', false)
  })

  it('keeps image dimension preparation enabled for older text-batch requests by default', async () => {
    vi.mocked(getActiveBook).mockResolvedValue(activeBook as Awaited<ReturnType<typeof getActiveBook>>)
    vi.mocked(readReaderTextBatch).mockResolvedValue({ revisionId: 'revision-1', items: [] })
    const response = await appFor().request('/api/v1/books/book-1/reader/texts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisionId: 'revision-1', paths: ['OEBPS/text/ch1.xhtml'] }),
    })
    expect(response.status).toBe(200)
    expect(readReaderTextBatch).toHaveBeenCalledWith(expect.anything(), ['OEBPS/text/ch1.xhtml'], true)
  })
})
