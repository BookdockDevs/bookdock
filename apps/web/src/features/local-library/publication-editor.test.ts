import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { EditorTxtSaveReq } from '@bookdock/shared'

import { prepareEditedLocalTxt, prepareLocalTxt } from './prepare-txt'
import { prepareEditedTxtInWorker } from './prepare-txt-worker'
import { saveLocalTxt } from './publication-editor'
import { LocalLibraryRepository } from './repository'

vi.mock('./prepare-txt-worker', () => ({ prepareEditedTxtInWorker: vi.fn() }))
const ref = { scope: { kind: 'local' as const, vaultId: 'editor' }, bookId: 'txt' }
let repository: LocalLibraryRepository
let draft: EditorTxtSaveReq
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local TXT editing must not use HTTP') }))
  repository = new LocalLibraryRepository('txt-editor')
  const original = new Blob(['Chapter 1\n\nOriginal text.'])
  const prepared = await prepareLocalTxt(original, 'Original.txt', 'Book', 'before')
  await repository.addBook({ ref, content: { book: ref, contentId: 'before' }, format: 'txt', textSource: prepared.source, title: 'Book', authors: [], availability: 'available', size: original.size, version: 0, createdAt: 1, updatedAt: 1 }, original, undefined, prepared)
  const text = await prepared.normalizedText.text()
  draft = { baseRevisionId: 'before', chapters: prepared.source.chapters.map((chapter, index) => ({ id: String(index), title: chapter.title, level: chapter.level, content: text.slice(chapter.contentStartOffset, chapter.endOffset) })) }
  vi.mocked(prepareEditedTxtInWorker).mockReset().mockImplementation(async (input, fileName, title, id, signal) => { signal.throwIfAborted(); return prepareEditedLocalTxt(input, fileName, title, id) })
})
afterEach(async () => { await repository.close(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

it('saves a rule snapshot without invalidating unchanged content or persisting a Server rule identity', async () => {
  draft.tocRuleSelection = { ruleId: 'connected-account-rule', patterns: [{ level: 1, regex: '^Chapter', replacement: null, enabled: true }], label: 'Selected rule', auto: false }
  const result = await saveLocalTxt(ref, draft, 'unused-new-id', new AbortController().signal, repository)
  expect(result.data).toMatchObject({ changed: false, revisionId: 'before' })
  expect(prepareEditedTxtInWorker).not.toHaveBeenCalled()
  const book = await repository.getBook(ref)
  expect(book.textSource?.ruleSelection).toEqual({ patterns: draft.tocRuleSelection.patterns, label: 'Selected rule', auto: false })
  expect(book.textSource?.ruleSelection).not.toHaveProperty('ruleId')
  expect(await (await repository.getFile(ref)).text()).toBe('Chapter 1\n\nOriginal text.')
})

it('replays a saved intent without rebuilding bytes and rejects a changed replay', async () => {
  draft.chapters[0]!.content = 'Edited text.'
  const signal = new AbortController().signal
  const saved = await saveLocalTxt(ref, draft, 'after', signal, repository)
  expect(saved.data).toMatchObject({ changed: true, revisionId: 'after' })
  await repository.updateMetadata(ref, { title: 'Renamed after saving' }, (await repository.getBook(ref)).version)
  expect(await saveLocalTxt(ref, draft, 'after', signal, repository)).toEqual(saved)
  expect(prepareEditedTxtInWorker).toHaveBeenCalledTimes(1)
  await expect(saveLocalTxt(ref, { ...draft, chapters: [{ ...draft.chapters[0]!, content: 'Different' }] }, 'after', signal, repository)).rejects.toMatchObject({ category: 'conflict' })
  expect(await repository.getNormalizedTxt(ref, 'after')).toContain('Edited text.')
})

it('retains the existing rule snapshot when a later body save omits optional rule metadata', async () => {
  const selection = { patterns: [{ level: 1, regex: '^Chapter', replacement: null, enabled: true }], label: 'Keep rule', auto: false }
  await repository.saveTxtRuleSelection(ref, 'before', selection)
  draft.chapters[0]!.content = 'Edited with the existing rule.'
  await saveLocalTxt(ref, draft, 'after', new AbortController().signal, repository)
  expect((await repository.getBook(ref)).textSource?.ruleSelection).toEqual(selection)
})

it('does not resurrect a publication removed while its worker result was being prepared', async () => {
  draft.chapters[0]!.content = 'Edited text.'
  vi.mocked(prepareEditedTxtInWorker).mockImplementationOnce(async (input, fileName, title, id) => {
    const prepared = await prepareEditedLocalTxt(input, fileName, title, id)
    await repository.removeBook(ref)
    return prepared
  })
  await expect(saveLocalTxt(ref, draft, 'after', new AbortController().signal, repository)).rejects.toMatchObject({ category: 'unavailable-content' })
  expect(await repository.hasPublication(ref)).toBe(false)
})
