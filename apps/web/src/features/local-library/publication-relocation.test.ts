import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createEpubCfiTextOffset, createEpubCfiTextRange, extractEpubMarkupText, resolveEpubCfiTextRange } from '@bookdock/shared'

import { processLocalEpub } from './epub-editor'
import { preparePublicationRelocationInWorker } from './epub-editor-worker'
import { prepareEditedLocalTxt } from './prepare-txt'
import { relocatePublication } from './publication-relocation'
import { LocalLibraryRepository } from './repository'
import { saveLocalTxt } from './publication-editor'

vi.mock('./epub-editor-worker', () => ({ preparePublicationRelocationInWorker: vi.fn() }))
vi.mock('./prepare-txt-worker', () => ({ prepareEditedTxtInWorker: vi.fn(async (draft, fileName, title, contentId) => {
  const { prepareEditedLocalTxt } = await import('./prepare-txt')
  return prepareEditedLocalTxt(draft, fileName, title, contentId)
}) }))
const ref = { scope: { kind: 'local' as const, vaultId: 'relocation' }, bookId: 'book' }
let repository: LocalLibraryRepository
let original: Blob
let target: Blob
let sourceDocuments: { href: string; content: string }[]
let targetDocuments: { href: string; content: string }[]

async function run(input: Parameters<typeof preparePublicationRelocationInWorker>[0]) {
  const signal = new AbortController().signal
  const [source, target] = await Promise.all([processLocalEpub(input.source, signal), processLocalEpub(input.target, signal)])
  return relocatePublication(input.snapshot, input.contentId, source.source.documents, target.source.documents, source.source.spineOrder, target.source.spineOrder)
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Relocation must remain local') }))
  repository = new LocalLibraryRepository('publication-relocation')
  const prefix = 'A'.repeat(100)
  const suffix = 'B'.repeat(100)
  const source = await prepareEditedLocalTxt({ baseRevisionId: 'before', chapters: [{ id: 'one', title: 'One', level: 1, content: `${prefix}\nKeep this exact quote\n${suffix}\nDelete this exact quote` }, { id: 'two', title: 'Two', level: 1, content: 'Unchanged second chapter text.' }] }, 'book.txt', 'Book', 'before')
  const next = await prepareEditedLocalTxt({ baseRevisionId: 'before', chapters: [{ id: 'one', title: 'One', level: 1, content: `New inserted paragraph\n${prefix}\nKeep this exact quote\n${suffix}` }, { id: 'two', title: 'Two', level: 1, content: 'Unchanged second chapter text.' }] }, 'book.txt', 'Book', 'after')
  original = source.publication; target = next.publication
  sourceDocuments = (await processLocalEpub(original, new AbortController().signal)).source.documents
  targetDocuments = (await processLocalEpub(target, new AbortController().signal)).source.documents
  await repository.addBook({ ref, content: { book: ref, contentId: 'before' }, format: 'epub', title: 'Book', authors: [], availability: 'available', size: original.size, version: 0, createdAt: 1, updatedAt: 1 }, original)
  vi.mocked(preparePublicationRelocationInWorker).mockReset().mockImplementation(run)
})
afterEach(async () => { await repository.close(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

it('maps real CFI progress, quotes, bookmarks, coverage and point replacements while retaining unresolved anchors', async () => {
  const first = sourceDocuments[0]!
  const texts = extractEpubMarkupText(sourceDocuments.map((document) => ({ href: document.href, markup: document.content })))
  const text = texts.get(first.href)!
  const quote = 'Keep this exact quote'
  const start = text.indexOf(quote)
  const deleted = 'Delete this exact quote'
  const deletedStart = text.indexOf(deleted)
  const position = { content: { book: ref, contentId: 'before' }, schemaVersion: 1 as const, kind: 'epub-cfi' as const, value: createEpubCfiTextOffset(first.content, 0, start)!, href: first.href }
  await repository.saveState({ book: ref, readStatus: 'reading', position, fraction: 0.4, coverage: { content: position.content, fraction: 1, available: true }, lastReadAt: 10, updatedAt: 10, version: 0 }, 0, [[0, 1]])
  const roundId = (await repository.readReadingRounds(ref)).rounds[0]!.id
  const base = { book: ref, chapter: 'One', createdAt: 10, updatedAt: 10, version: 0 }
  await repository.saveNote({ ...base, id: 'keep', kind: 'highlight', text: quote, color: 'yellow', style: 'highlight', locator: { ...position, value: createEpubCfiTextRange(first.content, 0, start, start + quote.length)! } }, 0)
  await repository.saveNote({ ...base, id: 'deleted', kind: 'idea', body: 'Retain my thought', text: deleted, locator: { ...position, value: createEpubCfiTextRange(first.content, 0, deletedStart, deletedStart + deleted.length)! } }, 0)
  const second = sourceDocuments[1]!
  await repository.saveNote({ ...base, id: 'bookmark', kind: 'bookmark', title: 'Second', context: '', locator: { ...position, href: second.href, value: createEpubCfiTextOffset(second.content, 1, 5)! } }, 0)
  await repository.mutateReplacement('relocation', 'point', { create: { bookId: ref.bookId, matchType: 'point', spineHref: first.href, textOffset: start, originalText: quote, replacement: 'Personal replacement' }, expectedContentId: 'before' })
  const saved = await repository.replacePublication({ book: ref, baseContentId: 'before', contentId: 'after' }, target)
  expect(saved.unlocated).toMatchObject({ progress: 0, highlights: 0, bookmarks: 0, notes: 1, pointReplacements: 0 })
  const state = (await repository.getState(ref))!
  expect(state.position?.content.contentId).toBe('after')
  expect(state.positionHistory?.[0]?.position?.value).toBe(position.value)
  expect(state.lastReadAt).toBe(10)
  expect(state.coverage?.fraction).toBeGreaterThan(0)
  expect(state.coverage?.fraction).toBeLessThan(1)
  const notes = await repository.listNotes(ref)
  const kept = notes.find((note) => note.id === 'keep')!
  expect(kept.locator?.content.contentId).toBe('after')
  const range = resolveEpubCfiTextRange(targetDocuments[0]!.content, kept.locator!.value)!
  const targetText = extractEpubMarkupText(targetDocuments.map((document) => ({ href: document.href, markup: document.content }))).get(first.href)!
  expect(targetText.slice(range.start, range.end)).toBe(quote)
  expect(notes.find((note) => note.id === 'deleted')?.locator?.content.contentId).toBe('before')
  expect(notes.find((note) => note.id === 'bookmark')?.locator?.content.contentId).toBe('after')
  expect((await repository.readReplacements('relocation', ref.bookId)).data[0]).toMatchObject({ locationAvailable: true, originalText: quote })
  const rounds = await repository.readReadingRounds(ref)
  expect(rounds.rounds).toHaveLength(1)
  expect(rounds.rounds[0]).toMatchObject({ id: roundId, coverage: { content: { contentId: 'after' } }, coverageHistory: [{ content: { contentId: 'before' }, intervals: [[0, 1]] }] })
  expect(new Uint8Array(await (await repository.getFile(ref, true)).arrayBuffer())).toEqual(new Uint8Array(await original.arrayBuffer()))
})

it('rejects new notes arriving during preparation rather than promoting bytes with an unmapped late record', async () => {
  await repository.saveState({ book: ref, readStatus: 'reading', position: null, fraction: null, coverage: { content: { book: ref, contentId: 'before' }, fraction: 0, available: true }, lastReadAt: null, updatedAt: 1, version: 0 }, 0)
  vi.mocked(preparePublicationRelocationInWorker).mockImplementationOnce(async (input) => {
    const result = await run(input)
    await repository.saveNote({ id: 'late', book: ref, kind: 'idea', body: 'Saved in another tab', text: '', locator: null, chapter: null, createdAt: 1, updatedAt: 1, version: 0 }, 0)
    return result
  })
  await expect(repository.replacePublication({ book: ref, baseContentId: 'before', contentId: 'after' }, target)).rejects.toMatchObject({ category: 'conflict' })
  expect((await repository.getBook(ref)).content?.contentId).toBe('before')
  expect((await repository.listNotes(ref))[0]?.id).toBe('late')
})

it('uses the same relocation from the TXT save workflow and keeps structural-title edits fully covered', async () => {
  const txtRef = { ...ref, bookId: 'txt' }
  const body = `${'A'.repeat(100)}\nA quote to retain\n${'B'.repeat(100)}`
  const draft = { baseRevisionId: 'txt-before', chapters: [{ id: 'chapter', title: 'Before', level: 1, content: body, structureOnlyTitle: true }] }
  const prepared = await prepareEditedLocalTxt(draft, 'original.txt', 'Book', 'txt-before')
  await repository.addBook({ ref: txtRef, content: { book: txtRef, contentId: 'txt-before' }, format: 'txt', textSource: prepared.source, title: 'Book', authors: [], availability: 'available', size: prepared.normalizedText.size, version: 0, createdAt: 1, updatedAt: 1 }, prepared.normalizedText, undefined, prepared)
  const source = (await processLocalEpub(prepared.publication, new AbortController().signal)).source.documents[0]!
  const text = extractEpubMarkupText([{ href: source.href, markup: source.content }]).get(source.href)!
  const offset = text.indexOf('A quote to retain')
  const position = { content: { book: txtRef, contentId: 'txt-before' }, schemaVersion: 1 as const, kind: 'epub-cfi' as const, href: source.href, value: createEpubCfiTextOffset(source.content, 0, offset)! }
  await repository.saveState({ book: txtRef, readStatus: 'reading', position, fraction: 0.5, coverage: { content: position.content, fraction: 1, available: true }, lastReadAt: 1, updatedAt: 1, version: 0 }, 0, [[0, 1]])
  const result = await saveLocalTxt(txtRef, { ...draft, chapters: [{ ...draft.chapters[0]!, title: 'After' }] }, 'txt-after', new AbortController().signal, repository)
  expect(result.data.unlocated.progress).toBe(0)
  const state = (await repository.getState(txtRef))!
  expect(state.position?.content.contentId).toBe('txt-after')
  expect(state.coverage?.fraction).toBeCloseTo(1)
})
