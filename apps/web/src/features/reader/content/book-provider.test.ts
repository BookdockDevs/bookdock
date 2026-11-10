import { describe, expect, it, vi } from 'vitest'
import { localEpubProvider } from './local-epub-provider'
import { remoteBookProvider } from './book-provider'

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
})
