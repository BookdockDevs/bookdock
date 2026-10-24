import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBooksArchive, prepareBookFile } from '@/features/library/download'

afterEach(() => vi.unstubAllGlobals())

describe('batch download file preparation', () => {
  it('uses existing endpoints for raw EPUB, normalized original TXT and edited EPUB exports', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Disposition': "attachment; filename*=UTF-8''Book.epub" }),
      blob: async () => new Blob(['file'], { type: 'application/epub+zip' }),
    } as Response))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await prepareBookFile({ id: 'raw', title: 'Raw', sourceFormat: 'epub', format: 'epub', edited: false }, signal)
    await prepareBookFile({ id: 'plain', title: 'Plain', sourceFormat: 'txt', format: 'txt', edited: false }, signal)
    await prepareBookFile({ id: 'edited', title: 'Edited', sourceFormat: 'txt', format: 'epub', edited: true }, signal)

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/v1/books/raw/file',
      '/api/v1/books/plain/export.txt?plain=1',
      '/api/v1/books/edited/export.epub',
    ])
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal === signal)).toBe(true)
  })

  it('sanitizes and de-duplicates archive names without dropping same-title books', async () => {
    const archive = await createBooksArchive([
      { blob: new Blob(['one'], { type: 'text/plain' }), filename: 'same.txt' },
      { blob: new Blob(['two'], { type: 'text/plain' }), filename: 'same.txt' },
      { blob: new Blob(['three'], { type: 'text/plain' }), filename: 'bad/name?.txt' },
    ])
    const reader = new ZipReader(new BlobReader(archive))
    const entries = await reader.getEntries()
    expect(entries.map((entry) => entry.filename)).toEqual(['same.txt', 'same (2).txt', 'bad_name_.txt'])
    const contents = await Promise.all(entries.map(async (entry) => {
      const writer = new BlobWriter()
      await entry.getData!(writer)
      return await (await writer.getData()).text()
    }))
    expect(contents).toEqual(['one', 'two', 'three'])
    await reader.close()
  })

  it('cancels ZIP preparation when its signal is aborted', async () => {
    const controller = new AbortController()
    const preparing = createBooksArchive([
      { blob: new Blob([new Uint8Array(1024 * 1024)], { type: 'text/plain' }), filename: 'book.txt' },
    ], controller.signal)
    controller.abort()

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' })
  })
})
