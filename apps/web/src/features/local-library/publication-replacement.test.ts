import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory, IDBObjectStore, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook } from '@bookdock/shared'

import { getProgressRestoreTarget } from '../reader/lib/progress-restoration'
import { prepareEditedLocalTxt, prepareLocalTxt } from './prepare-txt'
import { openLocalReaderSession } from './reader-session'
import { localLibraryRepository as repository } from './repository'


vi.mock('./epub-editor-worker', () => ({ preparePublicationRelocationInWorker: vi.fn(async (input) => {
  const { processLocalEpub } = await import('./epub-editor')
  const { relocatePublication } = await import('./publication-relocation')
  const signal = new AbortController().signal
  const [source, target] = await Promise.all([processLocalEpub(input.source, signal), processLocalEpub(input.target, signal)])
  return relocatePublication(input.snapshot, input.contentId, source.source.documents, target.source.documents, source.source.spineOrder, target.source.spineOrder)
}) }))

const ref = { scope: { kind: 'local' as const, vaultId: 'editing' }, bookId: 'book' }
const book: ClientBook = { ref, content: { book: ref, contentId: 'before' }, title: 'Book', authors: [], format: 'epub', availability: 'available', size: 6, version: 0, createdAt: 1, updatedAt: 1 }
const command = { book: ref, baseContentId: 'before', contentId: 'after' }
const location = { revisionId: 'before', cfi: 'epubcfi(/6/4!/4/2:0)', contentCfi: 'epubcfi(/6/4!/4/2:0)', percent: 30, fraction: 0.3, segmentStartFraction: 0.1 }
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Publication replacement must not use HTTP') }))
  await repository.addBook(book, new Blob(['Before']))
})
afterEach(async () => { await repository.close(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('source-owned publication promotion', () => {
  it.each([false, true])('clears unpublished local drafts atomically with content removal and rejects a late writer; complete=%s', async (complete) => {
    const key = JSON.stringify([ref.scope, 'epub', ref.bookId, null])
    const draft = { version: 1 as const, key, revisionId: 'before', token: 'draft-token', savedAt: 1, payload: { text: 'Unpublished private body' } }
    expect(await repository.replaceEditorDraft(ref, 'epub', null, draft, () => true)).toBe(true)
    await repository.removeBook(ref, complete)
    await expect(repository.replaceEditorDraft(ref, 'epub', null, draft, () => true)).rejects.toMatchObject({ category: 'unavailable-content' })
    if (!complete) expect(await repository.readEditorDraft(ref, 'epub')).toBeUndefined()
    const stored = await new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open('bookdock-local-library')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const tx = open.result.transaction('settings', 'readonly')
        const request = tx.objectStore('settings').get(JSON.stringify(['editor-draft', 'local', ref.scope.vaultId, ref.bookId, 'epub']))
        tx.oncomplete = () => { open.result.close(); resolve(request.result) }
        tx.onerror = () => reject(tx.error)
      }
    })
    expect(stored).toBeUndefined()
  })
  it('preserves originals, unrelated metadata and old-basis private records without restoring old anchors into new content', async () => {
    const ref = { scope: { kind: 'local' as const, vaultId: 'editing' }, bookId: 'real-publication' }
    const command = { book: ref, baseContentId: 'before', contentId: 'after' }
    const original = (await prepareLocalTxt(new Blob(['A'.repeat(200)]), 'source.txt', 'Book', 'before')).publication
    const updated = (await prepareLocalTxt(new Blob(['Z'.repeat(200)]), 'source.txt', 'Book', 'after')).publication
    await repository.addBook({ ...book, ref, content: { book: ref, contentId: 'before' } }, original)
    const oldReader = await openLocalReaderSession(ref, true)
    await oldReader.saveProgress(location)
    const note = (await oldReader.createNote({ type: 'highlight', cfiRange: location.cfi, revisionId: 'before', text: 'Retain quotation' })).data
    await repository.updateMetadata(ref, { title: 'Renamed while preparing' }, 0)
    const stateBefore = await repository.getState(ref)
    const roundBefore = (await repository.readReadingRounds(ref)).rounds[0]!
    const saved = await repository.replacePublication(command, updated)
    expect(saved).toMatchObject({ revisionId: 'after', changed: true, unlocated: { progress: 1, coverage: 0, highlights: 1, bookmarks: 0, notes: 0 } })
    expect(await repository.getState(ref)).toMatchObject({ position: stateBefore!.position, fraction: stateBefore!.fraction, fractionContent: { contentId: 'before' }, coverage: { content: { contentId: 'after' }, available: true, fraction: 0 } })
    expect((await repository.getBook(ref)).title).toBe('Renamed while preparing')
    expect((await repository.getBook(ref)).version).toBe(2)
    expect(new Uint8Array(await (await repository.getFile(ref)).arrayBuffer())).toEqual(new Uint8Array(await updated.arrayBuffer()))
    expect(new Uint8Array(await (await repository.getFile(ref, true)).arrayBuffer())).toEqual(new Uint8Array(await original.arrayBuffer()))
    const reader = await openLocalReaderSession(ref, true)
    const progress = (await reader.getProgress()).data
    expect(progress).toMatchObject({ progressRevisionId: 'before', locationAvailable: false, coverageAvailable: true })
    expect(getProgressRestoreTarget(progress)).toEqual({ cfi: '', contentCfi: '', fraction: undefined })
    expect((await reader.listNotes()).data[0]).toMatchObject({ id: note.id, text: 'Retain quotation', locationAvailable: false })
    await expect(oldReader.saveProgress(location)).rejects.toMatchObject({ category: 'invalid-input' })
    await reader.saveProgress({ ...location, revisionId: 'after', percent: 60, fraction: 0.6, segmentStartFraction: 0.5 })
    const rounds = (await repository.readReadingRounds(ref)).rounds
    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({ id: roundBefore.id, coverage: { content: { contentId: 'after' }, intervals: [[0.5, 0.6]] }, coverageHistory: [{ content: { contentId: 'before' }, intervals: [[0.1, 0.3]] }] })
    const overview = (await reader.getReadingLedger()).data
    expect(overview.coverage).toBeCloseTo(0.1)
    expect(overview.unalignedCoverage).toBe(true)
    expect((await reader.getProgress()).data).toMatchObject({ progressRevisionId: 'after', locationAvailable: true, coverageAvailable: true })
  })

  it('keeps idempotency scoped to the current head and refuses stale, altered or retired content identities', async () => {
    const file = new Blob(['After'])
    const result = await repository.replacePublication(command, file)
    expect(await repository.replacePublication(command, file)).toEqual(result)
    await expect(repository.replacePublication(command, new Blob(['Changed payload']))).rejects.toMatchObject({ category: 'conflict' })
    await repository.replacePublication({ ...command, baseContentId: 'after', contentId: 'successor' }, new Blob(['Successor']))
    await expect(repository.replacePublication(command, file)).rejects.toMatchObject({ category: 'conflict' })
    await expect(repository.replacePublication({ ...command, baseContentId: 'successor', contentId: 'before' }, new Blob(['Before']))).rejects.toMatchObject({ category: 'conflict' })
    expect(await (await repository.getFile(ref)).text()).toBe('Successor')
    expect(await (await repository.getFile(ref, true)).text()).toBe('Before')
    await repository.removeBook(ref)
    await expect(repository.replacePublication({ ...command, baseContentId: 'after', contentId: 'successor' }, new Blob(['Successor']))).rejects.toMatchObject({ category: 'unavailable-content' })
    await expect(repository.getFile(ref, true)).rejects.toMatchObject({ category: 'unavailable-content' })
  })

  it('promotes normalized TXT and its actual generated publication together, including a valid empty edited body', async () => {
    const txtRef = { ...ref, bookId: 'text' }
    const original = new Blob(['Chapter 1\n\nOriginal text'])
    const prepared = await prepareLocalTxt(original, 'Original.txt', 'Text', 'text-before')
    await repository.addBook({ ...book, ref: txtRef, content: { book: txtRef, contentId: 'text-before' }, format: 'txt', textSource: prepared.source }, original, undefined, prepared)
    const empty = await prepareEditedLocalTxt({ baseRevisionId: 'text-before', chapters: [{ id: 'body', title: '', content: '', level: 0 }] }, 'Original.txt', 'Text', 'text-after')
    await repository.replacePublication({ book: txtRef, baseContentId: 'text-before', contentId: 'text-after', textSource: empty.source }, empty.normalizedText, empty)
    expect(await repository.getNormalizedTxt(txtRef, 'text-after')).toBe('')
    expect((await repository.getPublicationFile(txtRef)).size).toBe(empty.publication.size)
    expect(await (await repository.getFile(txtRef, true)).text()).toBe(await original.text())
    await expect(repository.getNormalizedTxt(txtRef, 'text-before')).rejects.toMatchObject({ category: 'conflict' })
  })

  it('rolls back file/original/identity changes on quota failure and honors cancellation before mutation', async () => {
    const put = IDBObjectStore.prototype.put
    const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'books') throw new DOMException('Quota exhausted', 'QuotaExceededError')
      return put.call(this, value, key)
    })
    await expect(repository.replacePublication(command, new Blob(['After']))).rejects.toMatchObject({ category: 'storage-full' })
    fail.mockRestore()
    expect((await repository.getBook(ref)).content?.contentId).toBe('before')
    expect(await (await repository.getFile(ref)).text()).toBe('Before')
    await repository.replacePublication(command, new Blob(['After']))
    const controller = new AbortController(); controller.abort()
    await expect(repository.replacePublication({ ...command, baseContentId: 'after', contentId: 'cancelled' }, new Blob(['Cancelled']), undefined, controller.signal)).rejects.toHaveProperty('name', 'AbortError')
    expect((await repository.getBook(ref)).content?.contentId).toBe('after')
  })
})
