import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientBook } from '@bookdock/shared'
import { resolveClientPresetBinding } from '@bookdock/shared'
import { localLibraryRepository as repository } from './repository'
import { openLocalReaderSession } from './reader-session'

const ref = { scope: { kind: 'local' as const, vaultId: 'vault' }, bookId: 'book' }
const book: ClientBook = { ref, title: 'Test', authors: [], format: 'epub', content: { book: ref, contentId: 'content' }, availability: 'available', size: 1, createdAt: 1, updatedAt: 1, version: 0 }
const position = { revisionId: 'content', percent: 50, fraction: 0.5, cfi: 'chapter:1:0', contentCfi: 'epubcfi(/6/4!/4/2:0)' }
beforeEach(async () => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob); await repository.addBook(book, new Blob(['x'])) })
afterEach(async () => { await repository.close(); vi.unstubAllGlobals() })

describe('local reader adapter behavior', () => {
  it('opens retained archives without losing actual publication availability and filters note dates in the requested timezone', async () => {
    const reader = await openLocalReaderSession(ref)
    const note = (await reader.createNote({ type: 'note', cfiRange: position.contentCfi, note: 'Private idea', revisionId: 'content' })).data
    const archive = await openLocalReaderSession(ref, true)
    expect(archive.sourceAvailable).toBe(true)
    const result = await archive.getArchiveNotes()
    // A device book without a review reports an empty list, never a server read.
    expect(result.data.reviews).toEqual([])
    expect(result.data.annotations).toEqual([expect.objectContaining({ id: note.id, locationAvailable: true, clientVersion: 1 })])
    expect((await archive.getArchiveNotes({ from: '2000-01-01', to: '2000-01-02', timezone: 'UTC' })).data.annotations).toEqual([])
    await repository.removeBook(ref)
    expect((await archive.listNotes()).data[0]).toMatchObject({ id: note.id, locationAvailable: false })
    const retained = await openLocalReaderSession(ref, true)
    expect(retained.sourceAvailable).toBe(false)
    await retained.updateNote(note.id, { note: 'Still editable' }, 1)
    expect((await retained.getArchiveNotes()).data.annotations[0].note).toBe('Still editable')
  })

  it('deletes a stamped note selection atomically and rejects stale versions without deleting another note', async () => {
    const session = await openLocalReaderSession(ref, true)
    const create = (note: string) => session.createNote({ type: 'note', cfiRange: position.contentCfi, note, revisionId: 'content' })
    const first = (await create('First')).data
    const second = (await create('Second')).data
    await session.updateNote(second.id, { note: 'Newer' }, second.clientVersion)
    await expect(session.deleteNotes([first, second])).rejects.toMatchObject({ category: 'conflict' })
    expect((await session.listNotes()).data.map((note) => note.id).sort()).toEqual([first.id, second.id].sort())
    const current = (await session.listNotes()).data
    await session.deleteNotes(current)
    await session.deleteNotes(current)
    expect((await session.listNotes()).data).toEqual([])
  })
  it('persists book-specific overrides and owner-qualified preset binding without touching another book', async () => {
    const otherRef = { scope: ref.scope, bookId: 'other' }
    await repository.addBook({ ...book, ref: otherRef, content: { book: otherRef, contentId: 'other-content' } }, new Blob(['y']))
    const session = await openLocalReaderSession(ref)
    const owner = { kind: 'account' as const, connectionId: 'server-a', accountId: 'reader-a' }
    await session.saveSettings({ fontSize: 29, lineHeight: 2 })
    await session.bindPreset('same-preset-id', owner)
    await repository.close()
    const reopened = await openLocalReaderSession(ref)
    const detail = (await reopened.getBook()).data
    expect(detail.readerSettings?.viewSettings).toEqual({ fontSize: 29, lineHeight: 2 })
    expect(detail.clientPresetBinding).toEqual({ presetId: 'same-preset-id', owner })
    expect(resolveClientPresetBinding(detail.clientPresetBinding, owner)).toBe('same-preset-id')
    expect(resolveClientPresetBinding(detail.clientPresetBinding, { ...owner, accountId: 'reader-b' })).toBeNull()
    expect(resolveClientPresetBinding(detail.clientPresetBinding, { ...owner, connectionId: 'server-b' })).toBeNull()
    expect(resolveClientPresetBinding(detail.clientPresetBinding, { kind: 'device' })).toBeNull()
    expect((await (await openLocalReaderSession(otherRef)).getBook()).data.clientPresetBinding).toBeNull()
    await reopened.bindPreset(null, owner)
    expect((await reopened.getBook()).data.clientPresetBinding).toBeNull()
    expect((await reopened.getBook()).data.readerSettings?.viewSettings).toEqual({ fontSize: 29, lineHeight: 2 })
  })

  it('reads actual catalog metadata and percentages without fabricating a server file path', async () => {
    await repository.updateMetadata(ref, { catalog: { metadata: { publisher: 'Device publisher' } } }, 0)
    const session = await openLocalReaderSession(ref)
    await session.saveProgress(position)
    const detail = (await session.getBook()).data
    expect(detail).toMatchObject({ ref, title: 'Test', progress: 50, revisionId: 'content', clientVersion: 1, meta: { bookmeta: { publisher: 'Device publisher' } } })
    expect(detail).not.toHaveProperty('filePath')
    expect(detail).not.toHaveProperty('kind')
  })

  it('retains all captured segments when positions are coalesced without inventing time', async () => {
    const session = await openLocalReaderSession(ref)
    session.captureCoverage(0.1, 0.2); session.captureCoverage(0.4, 0.5)
    await session.saveProgress(position)
    const state = await repository.getState(ref)
    expect(state?.coverage?.fraction).toBeCloseTo(0.2)
    expect(state?.position?.value).toBe(position.contentCfi)
    const reopened = await openLocalReaderSession(ref)
    expect((await reopened.getProgress()).data?.readFraction).toBeCloseTo(0.2)
  })

  it('requires an explicit state reload after another reader writes', async () => {
    const first = await openLocalReaderSession(ref)
    const second = await openLocalReaderSession(ref)
    await first.saveProgress(position)
    await expect(second.saveProgress({ ...position, fraction: 0.7 })).rejects.toMatchObject({ category: 'conflict' })
    await second.getProgress()
    await second.saveProgress({ ...position, fraction: 0.7 })
    expect((await repository.getState(ref))?.fraction).toBe(0.7)
  })

  it('rejects incompatible locations and saves idempotent commands without duplication', async () => {
    const session = await openLocalReaderSession(ref)
    await expect(session.saveProgress({ ...position, contentCfi: undefined })).rejects.toMatchObject({ category: 'invalid-input' })
    await expect(session.createNote({ type: 'note', cfiRange: 'chapter:1:0', note: 'Invalid anchor' })).rejects.toMatchObject({ category: 'invalid-input' })
    const command = { type: 'note' as const, cfiRange: position.contentCfi, note: 'Idea', revisionId: 'content' }
    const initial = await session.createNote(command, 'same-command')
    expect((await session.createNote(command, 'same-command')).data.id).toBe(initial.data.id)
    expect(await repository.listNotes(ref)).toHaveLength(1)
    await session.deleteNote(initial.data.id)
    await expect(session.createNote(command, 'same-command')).rejects.toMatchObject({ category: 'conflict' })
  })

  it('persists the current chapter title across reopen', async () => {
    const session = await openLocalReaderSession(ref)
    await session.saveProgress({ ...position, chapter: 'Chapter 12' })
    const reopened = await openLocalReaderSession(ref)
    expect((await reopened.getProgress()).data?.chapter).toBe('Chapter 12')
  })

  it('persists, updates, and deletes local AI threads across reopen and removes them on complete deletion', async () => {
    const session = await openLocalReaderSession(ref)
    const saved = await session.saveAiThreadTurn({
      settings: { readingScope: 'to_here', enabledTools: [], assistantModeId: 'assistant' },
      userMessage: {
        id: 'u-1',
        role: 'user',
        revisionGroupId: null,
        revision: 0,
        content: '解释这段原文',
        context: null,
        retry: null,
        citations: [],
        events: [],
        createdAt: 1000,
        aborted: false,
      },
      assistantMessage: {
        id: 'a-1',
        role: 'assistant',
        revisionGroupId: null,
        revision: 0,
        content: '本地 AI 解释',
        context: null,
        retry: null,
        citations: [{ id: 'direct:selection', chapterIndex: 0, chapterId: 'direct:0', chapterTitle: 'First', startOffset: 0, endOffset: 2, excerpt: '原文', quote: '原文', textBasis: 'reader' }],
        events: [],
        createdAt: 1001,
        aborted: false,
      },
    })
    expect((await session.listAiThreads()).data).toHaveLength(1)
    expect((await session.getAiThread(saved.data.id)).data.messages).toHaveLength(2)
    expect((await session.getAiThread(saved.data.id)).data.messages[1]!.citations).toEqual([expect.objectContaining({ id: 'direct:selection', quote: '原文', textBasis: 'reader' })])

    await session.updateAiThread(saved.data.id, { title: '重命名对话' })
    const reopened = await openLocalReaderSession(ref)
    expect((await reopened.listAiThreads()).data[0]?.title).toBe('重命名对话')

    const result = { content: 'Finished in the background', context: null, citations: [], aborted: false }
    expect(await reopened.applyAiThreadResult(saved.data.id, 'a-1', result)).toBe(true)
    expect(await reopened.applyAiThreadResult(saved.data.id, 'a-1', result)).toBe(true)
    const completed = await reopened.getAiThread(saved.data.id)
    expect(completed.data.messages).toHaveLength(2)
    expect(completed.data.messages[1]?.content).toBe(result.content)

    await reopened.deleteAiThread(saved.data.id)
    expect((await reopened.listAiThreads()).data).toHaveLength(0)
    expect(await reopened.applyAiThreadResult(saved.data.id, 'a-1', result)).toBe(false)
    expect((await reopened.listAiThreads()).data).toHaveLength(0)

    await reopened.saveAiThreadTurn({
      settings: { readingScope: 'to_here', enabledTools: [], assistantModeId: 'assistant' },
      userMessage: { id: 'u-2', role: 'user', revisionGroupId: null, revision: 0, content: '第二个对话', context: null, retry: null, citations: [], events: [], createdAt: 2000, aborted: false },
      assistantMessage: { id: 'a-2', role: 'assistant', revisionGroupId: null, revision: 0, content: '回复', context: null, retry: null, citations: [], events: [], createdAt: 2001, aborted: false },
    })
    await repository.removeBook(ref, true)
    await expect(repository.listAiThreads(ref)).rejects.toMatchObject({ category: 'unavailable-content' })
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('bookdock-local-library')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const remainingAiThreads = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly')
      const req = tx.objectStore('settings').get(JSON.stringify(['ai-threads', 'local', 'device', ref.bookId]))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    expect(remainingAiThreads).toBeUndefined()
  })
})
import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
