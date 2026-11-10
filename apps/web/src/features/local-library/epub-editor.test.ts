import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import JSZip from 'jszip'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { prepareLocalTxt } from './prepare-txt'
import { processLocalEpub, describeEditorEpub, readEditorResource } from './epub-editor'
import { processEpubInWorker } from './epub-editor-worker'
import { readLocalEpub, saveLocalEpub } from './publication-editor'
import { prepareLocalBookFile } from '../reading-data/local-book-download'
import { LocalLibraryRepository } from './repository'

vi.mock('./epub-editor-worker', () => ({ processEpubInWorker: vi.fn() }))
const ref = { scope: { kind: 'local' as const, vaultId: 'epub-editor' }, bookId: 'book' }
let repository: LocalLibraryRepository
let file: Blob
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local publication must not use HTTP') }))
  repository = new LocalLibraryRepository('epub-editor-test')
  file = (await prepareLocalTxt(new Blob(['Chapter 1\n\nOriginal text.']), 'source.txt', 'Book', 'before')).publication
  await repository.addBook({ ref, content: { book: ref, contentId: 'before' }, format: 'epub', title: 'Book', authors: [], availability: 'available', size: file.size, version: 0, createdAt: 1, updatedAt: 1 }, file)
  vi.mocked(processEpubInWorker).mockReset().mockImplementation((input, signal) => processLocalEpub(input.file, signal, input.draft))
})
afterEach(async () => { await repository.close(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

it('patches real package bytes while retaining originals, rejecting stale saves and validating semantic replay', async () => {
  const signal = new AbortController().signal
  const loaded = await readLocalEpub(ref, 'before', signal, repository)
  const draft = { ...loaded.data, baseRevisionId: 'before', documents: loaded.data.documents.map((document) => ({ ...document, content: document.content.replace('Original text.', 'Changed text.') })) }
  expect((await saveLocalEpub(ref, draft, 'after', signal, repository)).data).toMatchObject({ changed: true, revisionId: 'after' })
  expect((await readLocalEpub(ref, 'after', signal, repository)).data.documents[0]!.content).toContain('Changed text.')
  expect(new Uint8Array(await (await repository.getFile(ref, true)).arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()))
  expect((await saveLocalEpub(ref, draft, 'after', signal, repository)).data.revisionId).toBe('after')
  await expect(saveLocalEpub(ref, { ...draft, documents: loaded.data.documents }, 'after', signal, repository)).rejects.toMatchObject({ category: 'conflict' })
  await expect(saveLocalEpub(ref, draft, 'another', signal, repository)).rejects.toMatchObject({ category: 'conflict' })
})

it('keeps unchanged identity, reads actual resources and rejects unsafe archive paths', async () => {
  const signal = new AbortController().signal
  const loaded = await readLocalEpub(ref, 'before', signal, repository)
  expect((await saveLocalEpub(ref, { ...loaded.data, baseRevisionId: 'before' }, 'unused', signal, repository)).data.changed).toBe(false)
  const path = loaded.data.documents[0]!.href
  expect((await describeEditorEpub(file, signal)).some((entry) => entry.path === path && entry.mediaType === 'application/xhtml+xml')).toBe(true)
  expect(await readEditorResource(file, path, undefined, signal)).toBe(loaded.data.documents[0]!.content)
  const zip = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()))
  zip.file('../escape.xhtml', '<html/>')
  await expect(processLocalEpub(new Blob([await zip.generateAsync({ type: 'arraybuffer' })]), signal)).rejects.toThrow('Unsafe')
})

it('applies actual local replacement rules to a generated TXT file without changing stored source bytes', async () => {
  const txtRef = { ...ref, bookId: 'txt-download' }
  const original = new Blob(['Chapter 1\n\nOriginal text.'])
  const prepared = await prepareLocalTxt(original, 'source.txt', 'Book', 'txt-before')
  await repository.addBook({ ref: txtRef, content: { book: txtRef, contentId: 'txt-before' }, textSource: prepared.source, format: 'txt', title: 'Book', authors: [], availability: 'available', size: original.size, version: 0, createdAt: 1, updatedAt: 1 }, original, undefined, prepared)
  await repository.mutateReplacement('epub-editor', 'rule', { create: { pattern: 'Original text.', replacement: 'Prepared output.' } })
  const output = await prepareLocalBookFile(txtRef, 'txt', true, new AbortController().signal, repository)
  expect(await output.text()).toContain('Prepared output.')
  expect(await (await repository.getFile(txtRef)).text()).toBe(await original.text())
})
