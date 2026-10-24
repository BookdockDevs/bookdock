import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { errorHandler, AppError } from '../../middleware/error'
import readerContentRoutes from './reader-content.routes'
import { getActiveBook } from './books.service'
import { getReaderManifest, readReaderEntryForWeb, readReaderTextBatch } from './reader-content.service'

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
