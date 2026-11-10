import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { LocalLibraryRepository } from './repository'

import { prepareLocalTxt } from './prepare-txt'

vi.mock('./epub-editor-worker', () => ({ preparePublicationRelocationInWorker: vi.fn(async (input) => {
  const { processLocalEpub } = await import('./epub-editor')
  const { relocatePublication } = await import('./publication-relocation')
  const signal = new AbortController().signal
  const [source, target] = await Promise.all([processLocalEpub(input.source, signal), processLocalEpub(input.target, signal)])
  return relocatePublication(input.snapshot, input.contentId, source.source.documents, target.source.documents, source.source.spineOrder, target.source.spineOrder)
}) }))

const ref = { scope: { kind: 'local' as const, vaultId: 'rules' }, bookId: 'same-book' }
let repository: LocalLibraryRepository
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  repository = new LocalLibraryRepository('replacement-test')
  await repository.addBook({ ref, content: { book: ref, contentId: 'before' }, format: 'epub', title: 'Book', authors: [], availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }, new Blob(['abc']))
})
afterEach(async () => { await repository.close(); vi.unstubAllGlobals() })

it('keeps vault-global and book rules independent and checks rule/override versions', async () => {
  await repository.mutateReplacement('rules', 'global', { create: { pattern: 'Old', replacement: 'New' } })
  await repository.mutateReplacement('rules', 'book', { create: { bookId: ref.bookId, pattern: 'Book', replacement: 'Text' }, expectedContentId: 'before' })
  expect((await repository.readReplacements('other', ref.bookId).catch(() => ({ data: [] }))).data).toEqual([])
  expect((await repository.readReplacements('rules')).data.map((row) => row.id)).toEqual(['global'])
  expect((await repository.readReplacements('rules', ref.bookId)).data.map((row) => row.id)).toEqual(['global', 'book'])
  await repository.overrideReplacement('rules', 'global', ref.bookId, false, 1)
  expect((await repository.readReplacements('rules', ref.bookId)).data[0]).toMatchObject({ enabled: true, effectiveEnabled: false, hasOverride: true, clientVersion: 2 })
  await expect(repository.mutateReplacement('rules', 'global', { update: { enabled: false }, expectedVersion: 1 })).rejects.toMatchObject({ category: 'conflict' })
  await expect(repository.deleteReplacements('rules', [{ id: 'global', version: 2 }, { id: 'book', version: 0 }])).rejects.toMatchObject({ category: 'conflict' })
  expect((await repository.readReplacements('rules', ref.bookId)).data).toHaveLength(2)
})

it('retains the actual point basis through content replacement and retires book rules on full removal', async () => {
  const ref = { scope: { kind: 'local' as const, vaultId: 'rules' }, bookId: 'real-book' }
  const original = (await prepareLocalTxt(new Blob(['A'.repeat(200)]), 'source.txt', 'Book', 'before')).publication
  const updated = (await prepareLocalTxt(new Blob(['Z'.repeat(200)]), 'source.txt', 'Book', 'after')).publication
  await repository.addBook({ ref, content: { book: ref, contentId: 'before' }, format: 'epub', title: 'Book', authors: [], availability: 'available', size: original.size, version: 0, createdAt: 1, updatedAt: 1 }, original)
  const create = { bookId: ref.bookId, matchType: 'point' as const, spineHref: 'chapter.xhtml', textOffset: 0, originalText: 'abc', replacement: 'changed' }
  await expect(repository.mutateReplacement('rules', 'stale', { create, expectedContentId: 'other' })).rejects.toMatchObject({ category: 'conflict' })
  await repository.mutateReplacement('rules', 'point', { create, expectedContentId: 'before' })
  await repository.replacePublication({ book: ref, baseContentId: 'before', contentId: 'after' }, updated)
  expect((await repository.readReplacements('rules', ref.bookId)).data[0]).toMatchObject({ locationAvailable: false, originalText: 'abc' })
  await repository.removeBook(ref)
  expect((await repository.readReplacements('rules', ref.bookId)).data).toHaveLength(1)
  await repository.removeBook(ref, true)
  expect((await repository.readReplacements('rules')).data).toEqual([])
})
