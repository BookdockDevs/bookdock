import { describe, expect, it, vi } from 'vitest'
import { clearLocalEpubCache, evictLocalEpubCacheByPrefix, localEpubProvider } from './local-epub-provider'
import { remoteBookProvider } from './book-provider'
import { FoliateReader } from '../renderers/FoliateReader'

function engine(entries: { filename: string; uncompressedSize: number; getData?: ReturnType<typeof vi.fn> }[]) {
  const close = vi.fn()
  let loader: any
  return {
    close,
    get loader() { return loader },
    foliate: {
      BlobReader: class {}, TextWriter: class {}, BlobWriter: class {},
      ZipReader: class { getEntries = async () => entries; close = close },
      EPUB: class { constructor(options: any) { loader = options } async init() { return { sections: [] } } },
    },
  }
}

describe('reader book providers', () => {
  it.each(['local:book-1', 'remote-cache:account:book-1:rev-1'])('searches complete EPUB chapters through %s', async (identity) => {
    const read = vi.fn().mockResolvedValue('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>未来的春天</p></body></html>')
    const test = engine([{ filename: 'chapter.xhtml', uncompressedSize: 100, getData: read }])
    const lease = await localEpubProvider(identity, new Blob()).open(test.foliate, new AbortController().signal)
    lease.book.sections = [{ id: 'chapter.xhtml' }]
    const reader = new FoliateReader(identity)
    Object.assign(reader, { book: lease.book, view: { renderer: { getContents: () => [] } } })
    const progress = vi.fn()
    expect(await reader.search('未来', undefined, progress)).toHaveLength(1)
    expect(progress.mock.lastCall?.[2]).toMatchObject({ incomplete: false })
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(lease.book.loadSectionText('chapter.xhtml', cancelled.signal)).rejects.toThrow()
    expect(await lease.book.loadSectionText('chapter.xhtml')).toContain('未来')
    lease.release()
  })

  it('retains existing remote book identity and refuses a cancelled open', async () => {
    const book = { sections: [] }
    const provider = remoteBookProvider('remote', async () => book)
    expect((await provider.open({}, new AbortController().signal)).book).toBe(book)
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(provider.open({}, cancelled.signal)).rejects.toThrow()
  })

  it('loads local resources without HTTP and releases each lease once', async () => {
    const read = vi.fn().mockResolvedValue('chapter')
    const test = engine([{ filename: 'chapter.xhtml', uncompressedSize: 7, getData: read }])
    const lease = await localEpubProvider('local', new Blob()).open(test.foliate, new AbortController().signal)
    const destroy = vi.fn()
    lease.book.destroy = destroy
    expect(await test.loader.loadText('chapter.xhtml')).toBe('chapter')
    expect(await test.loader.loadText('missing.xhtml')).toBeNull()
    lease.release(); lease.release()
    expect(test.close).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
    await expect(test.loader.loadText('chapter.xhtml')).rejects.toThrow('closed')
  })

  it.each(['../escape.xhtml', '/absolute.xhtml', 'bad\\path.xhtml'])('rejects unsafe archive path %s', async (filename) => {
    const test = engine([{ filename, uncompressedSize: 1 }])
    await expect(localEpubProvider('local', new Blob()).open(test.foliate, new AbortController().signal)).rejects.toThrow('path')
    expect(test.close).toHaveBeenCalledTimes(1)
  })

  it('rejects ambiguous paths and oversized declarations before extraction', async () => {
    for (const entries of [[{ filename: 'a', uncompressedSize: 1 }, { filename: 'a', uncompressedSize: 1 }], [{ filename: 'a', uncompressedSize: 65 * 1024 * 1024 }]]) {
      const test = engine(entries)
      await expect(localEpubProvider('local', new Blob()).open(test.foliate, new AbortController().signal)).rejects.toThrow()
      expect(test.close).toHaveBeenCalledTimes(1)
    }
  })

  it('reuses cached local EPUB archives across reopen and disposes after eviction', async () => {
    clearLocalEpubCache()
    const read = vi.fn().mockResolvedValue('chapter')
    const test = engine([{ filename: 'chapter.xhtml', uncompressedSize: 7, getData: read }])
    const firstAbort = new AbortController()
    const firstLease = await localEpubProvider('local:book-1:rev-1', new Blob(), { cache: true }).open(test.foliate, firstAbort.signal)
    firstLease.release()
    firstAbort.abort()

    const secondLease = await localEpubProvider('local:book-1:rev-1', new Blob(), { cache: true }).open(test.foliate, new AbortController().signal)
    expect(secondLease.book).toBe(firstLease.book)
    expect(await test.loader.loadText('chapter.xhtml')).toBe('chapter')
    expect(test.close).not.toHaveBeenCalled()

    evictLocalEpubCacheByPrefix('local:book-1:')
    expect(test.close).not.toHaveBeenCalled()
    secondLease.release()
    expect(test.close).toHaveBeenCalledTimes(1)
  })
})
