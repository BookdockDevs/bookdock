import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { TextDecoder, TextEncoder } from 'node:util'

import * as zip from '@zip.js/zip.js'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @ts-expect-error plain vendored ESM without type declarations
import { EPUB } from '../../../public/foliate-js/epub.js'
import { localCatalogOperations } from './catalog'
import { addLocalBook } from './ingest'
import { decodeLocalTxt, prepareEditedLocalTxt, prepareLocalTxt } from './prepare-txt'
import { prepareTxtInWorker } from './prepare-txt-worker'
import { readPublicationMetadata } from './publication-metadata'
import { openLocalReaderSession } from './reader-session'
import { localLibraryRepository as repository } from './repository'

vi.mock('./prepare-txt-worker', () => ({ prepareTxtInWorker: vi.fn() }))

const scope = { kind: 'local' as const, vaultId: 'device' }
const identity = { bookId: 'txt-book', contentId: 'txt-content', createdAt: 1 }
const ref = { scope, bookId: identity.bookId }
const text = 'Chapter 1 Start\r\n\r\nHello <script>alert(1)</script> & 世界。\r\n\r\nChapter 2 Next\r\n\r\nEnd.'
let file: File

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('File', NativeFile)
  vi.stubGlobal('TextDecoder', TextDecoder); vi.stubGlobal('TextEncoder', TextEncoder)
  vi.stubGlobal('FoliateReader', { ...zip, EPUB })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('TXT processing must not use HTTP') }))
  vi.mocked(prepareTxtInWorker).mockImplementation(async (input, title, contentId, signal) => { signal.throwIfAborted(); return prepareLocalTxt(input, input.name, title, contentId) })
  file = new File([text], 'Device book.txt')
})
afterEach(async () => { await repository.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('rebuilds edited TXT chapter boundaries and packaging on-device, including level-zero and empty editor nodes', async () => {
  const prepared = await prepareEditedLocalTxt({ baseRevisionId: 'before', chapters: [
    { id: 'volume', title: 'Volume', content: '', level: 0 },
    { id: 'chapter', title: 'Chapter', content: '  One.  \n\n\n\n 中文。 ', level: 1 },
  ] }, 'Original.txt', 'Edited book', 'after')
  const text = await prepared.normalizedText.text()
  expect(text).toBe('Volume\n\nChapter\n\nOne.\n\n中文。')
  expect(prepared.source.chapters[0]).toMatchObject({ level: 0, wordCount: 0, endOffset: 8 })
  expect(prepared.source.chapters[1]).toMatchObject({ startOffset: 8, contentStartOffset: 17, endOffset: text.length })
  const publication = await JSZip.loadAsync(new Uint8Array(await prepared.publication.arrayBuffer()))
  expect(await publication.file('OEBPS/chapter-0002.xhtml')!.async('string')).toContain('中文。')
  expect(await publication.file('OEBPS/content.opf')!.async('string')).toContain('Edited book')
  const empty = await prepareEditedLocalTxt({ baseRevisionId: 'before', chapters: [{ id: 'empty', title: '', content: '', level: 0 }] }, 'Original.txt', 'Book', 'empty')
  expect(empty.normalizedText.size).toBe(0)
  expect(empty.source).toMatchObject({ normalizedLength: 0, chapters: [{ startOffset: 0, endOffset: 0, wordCount: 0 }] })
  expect(empty.publication.size).toBeGreaterThan(0)
  await expect(prepareLocalTxt(new Blob([]), 'Empty.txt', 'Book', 'empty-import')).rejects.toThrow()
  await expect(decodeLocalTxt(new Blob(['Unsafe\u0000text']))).rejects.toThrow('invalid publication characters')
  expect(fetch).not.toHaveBeenCalled()
})

async function fileKeys(): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('bookdock-local-library')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const request = open.result.transaction('files').objectStore('files').getAllKeys()
      request.onsuccess = () => { open.result.close(); resolve(request.result) }
      request.onerror = () => { open.result.close(); reject(request.error) }
    }
  })
}

describe('device TXT processing and persistence', () => {
  it('rejects binary controls and oversized chapter counts before storing any files', async () => {
    await expect(addLocalBook(new File(['binary\0text'], 'Binary.txt'), scope.vaultId, identity)).rejects.toThrow('invalid publication characters')
    await expect(addLocalBook(new File(['Chapter 1\n\nText.\n\n'.repeat(10_001)], 'Dense.txt'), scope.vaultId, identity)).rejects.toThrow('chapter count')
    expect(await repository.listBooks(scope.vaultId)).toEqual([])
    expect(await fileKeys()).toEqual([])
  })

  it('opens an on-device publication through the existing provider and retains actual TXT facts', async () => {
    const book = await addLocalBook(file, scope.vaultId, identity)
    expect(book).toMatchObject({ format: 'txt', title: 'Device book', authors: [], textSource: { schemaVersion: 1, fileName: file.name } })
    expect(book.textSource?.chapters.map((chapter) => chapter.title)).toEqual(['Chapter 1 Start', 'Chapter 2 Next'])
    expect(await (await repository.getFile(ref)).text()).toBe(text)
    const normalized = await (await repository.getNormalizedText(ref)).text()
    expect(normalized).not.toContain('\r')
    expect(book.textSource?.normalizedLength).toBe(normalized.length)
    const publication = await JSZip.loadAsync(new Uint8Array(await (await repository.getPublicationFile(ref)).arrayBuffer()))
    expect(await publication.file('OEBPS/chapter-0001.xhtml')!.async('string')).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; 世界。')
    const session = await openLocalReaderSession(ref)
    const lease = await session.provider.open((globalThis as any).FoliateReader, new AbortController().signal)
    try {
      const document = await lease.book.sections[0].createDocument()
      expect(document.querySelector('script')).toBeNull()
      expect(document.documentElement.textContent).toContain('<script>alert(1)</script>')
    } finally { lease.release() }
    expect((await session.getStructure(new AbortController().signal)).sections.map((section) => section.wordCount)).toEqual(book.textSource?.chapters.map((chapter) => chapter.wordCount))
    const source = await readPublicationMetadata(repository, ref, new AbortController().signal)
    expect(source).toMatchObject({ format: 'txt', values: { title: 'Device book', authors: null, language: null }, provenance: { title: 'filename', authors: 'missing', language: 'missing' } })
    await repository.close()
    expect((await (await openLocalReaderSession(ref)).getBook()).data.meta.wordCount).toBe(book.textSource?.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps retries idempotent without matching distinct book identities or accepting changed bytes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const first = await addLocalBook(file, scope.vaultId, identity)
    vi.setSystemTime(Date.now() + 10_000)
    expect(await addLocalBook(file, scope.vaultId, identity)).toEqual(first)
    await localCatalogOperations(scope).acknowledgeIngestion(ref, file)
    await expect(localCatalogOperations(scope).acknowledgeIngestion(ref, new Blob(['different']))).rejects.toMatchObject({ category: 'conflict' })
    await addLocalBook(file, scope.vaultId, { ...identity, bookId: 'independent-book', contentId: 'independent-content' })
    expect(await repository.listBooks(scope.vaultId)).toHaveLength(2)
  })

  it('rolls back original, normalized and generated files when placement is invalid or promotion is cancelled', async () => {
    await expect(addLocalBook(file, scope.vaultId, { ...identity, catalog: { shelfId: 'missing' } })).rejects.toMatchObject({ category: 'invalid-input' })
    expect(await fileKeys()).toEqual([])
    const controller = new AbortController()
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key)
      if (typeof key === 'string' && key.startsWith('publication:')) queueMicrotask(() => controller.abort())
      return request
    })
    await expect(addLocalBook(file, scope.vaultId, { ...identity, signal: controller.signal })).rejects.toHaveProperty('name', 'AbortError')
    expect(await fileKeys()).toEqual([])
    expect(await repository.listBooks(scope.vaultId)).toEqual([])
  })

  it('removes every content representation while retaining personal records and rejecting replay after full deletion', async () => {
    const book = await addLocalBook(file, scope.vaultId, identity)
    await repository.saveNote({ id: 'idea', book: ref, kind: 'idea', locator: null, text: '', body: 'Retained idea', chapter: null, createdAt: 1, updatedAt: 1, version: 0 }, 0)
    await repository.removeBook(ref)
    expect(await fileKeys()).toEqual([])
    expect(await repository.listNotes(ref)).toHaveLength(1)
    await expect(repository.getPublicationFile(ref)).rejects.toMatchObject({ category: 'unavailable-content' })
    await expect(repository.getNormalizedText(ref)).rejects.toMatchObject({ category: 'unavailable-content' })
    await repository.removeBook(ref, true)
    const prepared = await prepareLocalTxt(file, file.name, book.title, identity.contentId)
    await expect(repository.addBook(book, file, undefined, prepared)).rejects.toMatchObject({ category: 'conflict' })
  })

  it('decodes UTF-16 BOM and legacy GB18030 input on-device', async () => {
    const utf16 = new File([Buffer.from('\ufeff第一章\n\n正文。', 'utf16le')], 'UTF16.txt')
    const first = await prepareLocalTxt(utf16, utf16.name, 'UTF16', 'utf16')
    expect(await first.normalizedText.text()).toContain('正文。')
    const gb = new File([new Uint8Array(Array.from({ length: 100 }, () => [0xd6, 0xd0, 0xce, 0xc4]).flat())], 'Legacy.txt')
    const second = await prepareLocalTxt(gb, gb.name, 'Legacy', 'legacy')
    expect(await second.normalizedText.text()).toBe('中文'.repeat(100))
    expect(second.source.encoding.toLowerCase()).toContain('gb')
  })

  it.each([true, false])('decodes UTF-32 BOM with littleEndian=%s without mistaking it for UTF-16', async (littleEndian) => {
    const content = '\ufeffChapter 1\n\nUnicode 世界 🐈'
    const points = [...content].map((character) => character.codePointAt(0)!)
    const bytes = new Uint8Array(points.length * 4)
    const view = new DataView(bytes.buffer)
    points.forEach((point, index) => view.setUint32(index * 4, point, littleEndian))
    const prepared = await prepareLocalTxt(new File([bytes], 'Unicode.txt'), 'Unicode.txt', 'Unicode', 'unicode-content')
    expect(await prepared.normalizedText.text()).toContain('Unicode 世界 🐈')
    expect(prepared.source.encoding).toBe(littleEndian ? 'UTF-32LE' : 'UTF-32BE')
  })

  it('normalizes title and author from TXT filename when normalizeTitle is enabled, and preserves raw name when disabled', async () => {
    const namedFile = new File(['正文内容。'], '《偷来的春天》01-42完本_作品作者：学会偷懒.txt')
    const normalizedBook = await addLocalBook(namedFile, scope.vaultId, { bookId: 'norm-book', contentId: 'norm-content', createdAt: 10 })
    expect(normalizedBook.title).toBe('偷来的春天')
    expect(normalizedBook.authors).toEqual(['学会偷懒'])

    const rawBook = await addLocalBook(namedFile, scope.vaultId, { bookId: 'raw-book', contentId: 'raw-content', createdAt: 11, normalizeTitle: false })
    expect(rawBook.title).toBe('《偷来的春天》01-42完本_作品作者：学会偷懒')
    expect(rawBook.authors).toEqual([])
  })
})
