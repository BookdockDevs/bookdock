import { Readable } from 'node:stream'

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { getStorage } from '../../storage'
import { errorHandler } from '../../middleware/error'
import { streamBookFile } from './book-file-response'

vi.mock('../../storage', () => ({ getStorage: vi.fn() }))

function appFor(data: Buffer, sizes: number[]) {
  let index = 0
  vi.mocked(getStorage).mockReturnValue({
    put: vi.fn(), delete: vi.fn(), exists: vi.fn().mockResolvedValue(true),
    size: vi.fn(async () => sizes[Math.min(index++, sizes.length - 1)]),
    get: vi.fn(async (_key, range) => Readable.from([range ? data.subarray(range.start, range.end + 1) : data])),
  })
  const app = new Hono()
  app.onError(errorHandler)
  app.on(['GET', 'HEAD'], '/file', (c) => streamBookFile(c, { filePath: 'book.epub', title: 'Book' }))
  return app
}

describe('file response byte boundaries', () => {
  it.each([4, 40])('declares actual whole-response length instead of stale size %s', async (size) => {
    const data = Buffer.from('complete EPUB bytes')
    const response = await appFor(data, [size]).request('/file')
    expect(response.headers.get('Content-Length')).toBe(String(data.length))
    expect(Buffer.from(await response.arrayBuffer())).toEqual(data)
  })

  it('re-resolves suffix ranges when a remote fill discovers a different file length', async () => {
    const data = Buffer.from('abcdef')
    const response = await appFor(data, [10, 6]).request('/file', { headers: { Range: 'bytes=-3' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 3-5/6')
    expect(response.headers.get('Content-Length')).toBe('3')
    expect(await response.text()).toBe('def')
  })

  it('rejects incomplete ranges rather than sending a response with a false length', async () => {
    const response = await appFor(Buffer.from('abc'), [6]).request('/file', { headers: { Range: 'bytes=0-5' } })
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('BOOK_FILE_MISSING')
  })
})
