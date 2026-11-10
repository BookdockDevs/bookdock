import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { ClientNote } from '@bookdock/shared'

import { LocalLibraryRepository } from './repository'

const ref = { scope: { kind: 'local' as const, vaultId: 'images' }, bookId: 'book' }
const other = { ...ref, bookId: 'other' }
let repository: LocalLibraryRepository
const image = () => new NativeFile([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], 'image.png', { type: 'image/png' }) as unknown as File
const note = (id: string): ClientNote => ({ id, book: ref, kind: 'idea', body: '', text: '', locator: null, chapter: null, createdAt: 1, updatedAt: 1, version: 0 })
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  repository = new LocalLibraryRepository('note-image-tests')
  for (const current of [ref, other]) await repository.addBook({ ref: current, content: { book: current, contentId: 'content' }, format: 'epub', title: 'Book', authors: [], availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }, new Blob(['abc']))
})
afterEach(async () => { await repository.close(); vi.unstubAllGlobals() })

it('claims images with note CAS, retains them with removed-source notes and releases them on deletion', async () => {
  const staged = await repository.stageNoteImage(ref, 'draft', undefined, image(), new AbortController().signal)
  const saved = await repository.saveNote(note('note'), 0, [], { draftId: 'draft', imageIds: [staged.id] })
  expect(saved.kind === 'idea' && saved.images).toEqual([staged])
  await repository.cancelNoteImages(ref, 'draft')
  await repository.removeBook(ref)
  await expect(repository.readNoteImage(ref, staged.id)).resolves.toHaveProperty('size', 9)
  await repository.deleteNote(ref, 'note', 1)
  await expect(repository.readNoteImage(ref, staged.id)).rejects.toMatchObject({ category: 'unavailable-content' })
})

it('rejects foreign drafts and books and rolls back image claims on stale note writes', async () => {
  const staged = await repository.stageNoteImage(ref, 'draft', undefined, image(), new AbortController().signal)
  await expect(repository.saveNote({ ...note('bad'), book: other }, 0, [], { draftId: 'draft', imageIds: [staged.id] })).rejects.toMatchObject({ category: 'conflict' })
  await expect(repository.saveNote(note('bad'), 0, [], { draftId: 'other', imageIds: [staged.id] })).rejects.toMatchObject({ category: 'conflict' })
  await repository.saveNote(note('note'), 0)
  await expect(repository.saveNote(note('note'), 0, [], { draftId: 'draft', imageIds: [staged.id] })).rejects.toMatchObject({ category: 'conflict' })
  await repository.cancelNoteImages(ref, 'draft')
  await expect(repository.readNoteImage(ref, staged.id)).rejects.toMatchObject({ category: 'unavailable-content' })
})

it('refuses spoofed image bytes and releases image bytes on full book removal', async () => {
  await expect(repository.stageNoteImage(ref, 'draft', undefined, new NativeFile(['text'], 'image.png', { type: 'image/png' }) as unknown as File, new AbortController().signal)).rejects.toMatchObject({ category: 'invalid-input' })
  const staged = await repository.stageNoteImage(ref, 'draft', undefined, image(), new AbortController().signal)
  await repository.saveNote(note('note'), 0, [], { draftId: 'draft', imageIds: [staged.id] })
  await repository.removeBook(ref, true)
  await expect(repository.readNoteImage(ref, staged.id)).rejects.toMatchObject({ category: 'unavailable-content' })
})
