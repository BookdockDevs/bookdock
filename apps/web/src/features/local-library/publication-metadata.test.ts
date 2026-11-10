import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook } from '@bookdock/shared'

// @ts-expect-error plain vendored ESM without type declarations
import { EPUB } from '../../../public/foliate-js/epub.js'
import { localEpubProvider } from '../reader/content/local-epub-provider'
import { publicationBookMetadata, publicationMetadata, readPublicationMetadata } from './publication-metadata'
import { LocalLibraryRepository } from './repository'
import { addLocalEpub } from './ingest'
import { readPublicationStructure } from './publication-structure'

vi.mock('../reader/content/load-engine', () => ({ loadFoliateEngine: async () => ({}) }))
vi.mock('../reader/content/local-epub-provider', () => ({ localEpubProvider: vi.fn() }))

const ref = { scope: { kind: 'local' as const, vaultId: 'device' }, bookId: 'book' }
const book: ClientBook = { ref, title: 'Edited title', authors: ['Edited author'], format: 'epub', content: { book: ref, contentId: 'content' }, availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }
let repository: LocalLibraryRepository
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  vi.mocked(localEpubProvider).mockReset()
  repository = new LocalLibraryRepository('publication-metadata')
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => { await repository.close(); vi.unstubAllGlobals() })

describe('local publication metadata', () => {
  it('uses the file projection during ingestion and releases rejected initial placement', async () => {
    const release = vi.fn()
    vi.mocked(localEpubProvider).mockReturnValue({ cacheIdentity: 'new-content', open: async () => ({ book: { metadata: {
      title: { en: 'File title' }, author: [{ name: 'Writer' }], publisher: { name: 'Publisher' }, language: ['en', 'zh-CN'],
      belongsTo: { series: { name: 'Series', position: '0' } },
    } }, release }) })
    const file = new NativeFile(['abc'], 'original.epub') as File
    const identity = { bookId: 'new-book', contentId: 'new-content', createdAt: 10, catalog: { shelfId: 'missing' } }
    await expect(addLocalEpub(file, 'device', identity, repository)).rejects.toMatchObject({ category: 'invalid-input' })
    expect((await repository.listBooks('device')).map((row) => row.ref.bookId)).toEqual(['book'])
    expect(release).toHaveBeenCalledOnce()
    const added = await addLocalEpub(file, 'device', { ...identity, catalog: {} }, repository)
    expect(added).toMatchObject({ title: 'File title', authors: ['Writer'], catalog: { metadata: { publisher: 'Publisher', language: 'en', languages: ['en', 'zh-CN'], seriesIndex: 0 } } })
    expect(await addLocalEpub(file, 'device', { ...identity, catalog: {} }, repository)).toEqual(added)
    expect(release).toHaveBeenCalledTimes(3)
  })

  it('projects actual EPUB parser metadata with file provenance and a zero series index', async () => {
    const files = new Map([
      ['META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
      ['book.opf', `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata>
        <dc:title xml:lang="en">Original title</dc:title><dc:creator>Original author</dc:creator><dc:publisher>Publisher</dc:publisher>
        <dc:description>Original description</dc:description><dc:language>en</dc:language><dc:language>zh-CN</dc:language>
        <dc:subject>Fiction</dc:subject><dc:identifier>urn:isbn:9780000000002</dc:identifier>
        <meta name="calibre:series" content="Series"/><meta name="calibre:series_index" content="0"/>
        </metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`],
      ['chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Text</p></body></html>'],
      ['nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><span>Part</span><ol><li><a href="chapter.xhtml">Chapter</a></li></ol></li></ol></nav></body></html>'],
    ])
    const publication = await new EPUB({ entries: [...files.keys()].map((filename) => ({ filename })), loadText: async (path: string) => files.get(path) ?? null, loadBlob: async () => null, getSize: () => 1 }).init()
    try {
      const source = publicationMetadata(publication.metadata, 'original.epub')
      expect(source).toMatchObject({ kind: 'file', fileName: 'original.epub', values: {
        title: 'Original title', authors: ['Original author'], publisher: 'Publisher', description: 'Original description',
        language: 'en', isbn: '9780000000002', subjects: ['Fiction'], series: 'Series', seriesIndex: 0,
      }, provenance: { title: 'file', seriesIndex: 'file', published: 'missing' } })
      expect(publicationBookMetadata(publication.metadata, source)).toMatchObject({ languages: ['en', 'zh-CN'], publisher: 'Publisher', seriesIndex: 0 })
      const release = vi.fn()
      vi.mocked(localEpubProvider).mockReturnValue({ cacheIdentity: 'content', open: async () => ({ book: publication, release }) })
      const structure = await readPublicationStructure(repository, ref, new AbortController().signal)
      expect(structure.content).toEqual(book.content)
      expect(structure.sections).toEqual([{ index: 0, href: 'chapter.xhtml', title: 'Chapter', byteLength: 1, wordCount: null }])
      expect(structure.navigation).toEqual([{ label: 'Part', href: null, children: [{ label: 'Chapter', href: 'chapter.xhtml', children: [] }] }])
      expect(structure.sections[0]).not.toHaveProperty('startOffset')
      expect(release).toHaveBeenCalledOnce()
    } finally { publication.destroy() }
  })

  it('reads retained bytes without writing edited metadata and always releases its lease', async () => {
    const release = vi.fn()
    vi.mocked(localEpubProvider).mockReturnValue({ cacheIdentity: 'content', open: async () => ({ book: { metadata: { title: 'Original file title' } }, release }) })
    const source = await readPublicationMetadata(repository, ref, new AbortController().signal)
    expect(source.values.title).toBe('Original file title')
    expect(source.values.authors).toBeNull()
    expect(source.provenance.authors).toBe('missing')
    expect(source.fileName).toBeNull()
    expect(await repository.getBook(ref)).toEqual(book)
    expect(release).toHaveBeenCalledOnce()
    // The reader opens the retained original bytes, so the engine cache is
    // keyed by the original file identity, not the derived content id.
    expect(localEpubProvider).toHaveBeenCalledWith(
      `original:${JSON.stringify([ref.scope, ref.bookId, book.content!.contentId])}`,
      expect.objectContaining({ size: 3 }),
    )
  })

  it.each([['metadata', readPublicationMetadata], ['structure', readPublicationStructure]] as const)('rejects removal during %s extraction and releases the opened content', async (_name, read) => {
    const release = vi.fn()
    vi.mocked(localEpubProvider).mockReturnValue({ cacheIdentity: 'content', open: async () => {
      await repository.removeBook(ref)
      return { book: { metadata: { title: 'Stale file' }, sections: [{ id: 'chapter.xhtml', size: 3 }] }, release }
    } })
    await expect(read(repository, ref, new AbortController().signal)).rejects.toMatchObject({ category: 'unavailable-content' })
    expect(release).toHaveBeenCalledOnce()
  })

  it.each([['metadata', readPublicationMetadata], ['structure', readPublicationStructure]] as const)('does not open cancelled %s work and releases work cancelled just after opening', async (_name, read) => {
    const controller = new AbortController()
    controller.abort()
    await expect(read(repository, ref, controller.signal)).rejects.toThrow()
    expect(localEpubProvider).not.toHaveBeenCalled()
    const active = new AbortController()
    const release = vi.fn()
    vi.mocked(localEpubProvider).mockReturnValue({ cacheIdentity: 'content', open: async () => {
      active.abort()
      return { book: { metadata: {} }, release }
    } })
    await expect(read(repository, ref, active.signal)).rejects.toThrow()
    expect(release).toHaveBeenCalledOnce()
  })

  it('rejects a malformed spine and releases its content instead of returning an empty success', async () => {
    const release = vi.fn()
    vi.mocked(localEpubProvider).mockReturnValue({ cacheIdentity: 'content', open: async () => ({ book: { sections: [] }, release }) })
    await expect(readPublicationStructure(repository, ref, new AbortController().signal)).rejects.toMatchObject({ category: 'invalid-input' })
    expect(release).toHaveBeenCalledOnce()
    expect(await repository.getBook(ref)).toEqual(book)
  })

  it('falls back to filename title and author normalization for local EPUBs when metadata is missing', async () => {
    const release = vi.fn()
    vi.mocked(localEpubProvider).mockReturnValue({ cacheIdentity: 'norm-epub', open: async () => ({ book: { metadata: {} }, release }) })
    const file = new NativeFile(['abc'], '《示例书名》作者：测试君.epub') as File
    const added = await addLocalEpub(file, 'device', { bookId: 'epub-norm', contentId: 'norm-epub', createdAt: 20 }, repository)
    expect(added.title).toBe('示例书名')
    expect(added.authors).toEqual(['测试君'])

    vi.mocked(localEpubProvider).mockReturnValue({ cacheIdentity: 'raw-epub', open: async () => ({ book: { metadata: {} }, release }) })
    const raw = await addLocalEpub(file, 'device', { bookId: 'epub-raw', contentId: 'raw-epub', createdAt: 21, normalizeTitle: false }, repository)
    expect(raw.title).toBe('《示例书名》作者：测试君')
    expect(raw.authors).toEqual([])
  })
})
