import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { localLibraryRepository as repository } from '@/features/local-library/repository'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { draftKey, readLocalDraft, replaceLocalDraft, type LocalDraftRecord } from './local-draft-store'

function fakeIndexedDb(options: { quota?: boolean; blocked?: boolean } = {}) {
  const records = new Map<string, LocalDraftRecord>()
  const db = {
    createObjectStore() { return { createIndex() {} } }, close() {},
    transaction() {
      const tx: Record<string, any> = { error: null }
      let aborted = false
      const finish = () => setTimeout(() => aborted ? tx.onabort?.() : tx.oncomplete?.(), 0)
      tx.abort = () => { aborted = true; tx.error = new Error('quota'); finish() }
      tx.objectStore = () => ({
        get(key: string) { const req: Record<string, any> = {}; queueMicrotask(() => { req.result = records.get(key); req.onsuccess?.(); finish() }); return req },
        index() { return { count(account: string) { const req: Record<string, any> = {}; queueMicrotask(() => { req.result = [...records.keys()].filter((key) => JSON.parse(key)[0] === account).length; req.onsuccess?.(); finish() }); return req } } },
        put(value: LocalDraftRecord) { if (options.quota) tx.abort(); else records.set(value.key, value) },
        delete(key: string) { records.delete(key) },
      })
      return tx
    },
  }
  return { records, indexedDB: { open() { const req: Record<string, any> = { result: db }; queueMicrotask(() => { if (options.blocked) req.onblocked?.(); else { req.onupgradeneeded?.(); req.onsuccess?.() } }); return req } } }
}

function record(key: string, token: string): LocalDraftRecord {
  return { version: 1, key, revisionId: 'rev', token, savedAt: Date.now(), payload: { text: 'draft' } }
}

afterEach(async () => { await repository.close(); vi.unstubAllGlobals() })

it('stores local-vault drafts without a fabricated account and keeps their quota and identity separate', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange); vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('crypto', webcrypto)
  const owner = { kind: 'local' as const, vaultId: 'device' }
  const add = async (scope: typeof owner, bookId: string) => {
    const ref = { scope, bookId }
    await repository.addBook({ ref, content: { book: ref, contentId: 'content' }, title: 'Book', authors: [], format: 'epub', availability: 'available', size: 1, version: 0, createdAt: 1, updatedAt: 1 }, new Blob(['x']))
  }
  for (let index = 0; index < 8; index++) {
    await add(owner, `book-${index}`)
    const key = draftKey(owner, `book-${index}`, 'epub')
    expect(await replaceLocalDraft(key, null, record(key, `token-${index}`), () => true)).toBe(true)
    expect(await readLocalDraft(key)).not.toHaveProperty('accountId')
  }
  await add(owner, 'ninth')
  const ninth = draftKey(owner, 'ninth', 'epub')
  await expect(replaceLocalDraft(ninth, null, record(ninth, 'ninth'), () => true)).rejects.toMatchObject({ category: 'storage-full' })
  for (const otherOwner of ['device', { kind: 'local' as const, vaultId: 'other' }]) {
    if (typeof otherOwner !== 'string') await add(otherOwner, 'book-0')
    const key = draftKey(otherOwner, 'book-0', 'epub')
    expect(await replaceLocalDraft(key, null, record(key, 'separate'), () => true)).toBe(true)
    expect((await readLocalDraft(key) as LocalDraftRecord).token).toBe('separate')
  }
  expect((await readLocalDraft(draftKey(owner, 'book-0', 'epub')) as LocalDraftRecord).token).toBe('token-0')
})

describe('local draft IndexedDB boundary', () => {
  it('conditionally writes and deletes without replacing an unseen version', async () => {
    const fake = fakeIndexedDb(); vi.stubGlobal('indexedDB', fake.indexedDB)
    const key = draftKey('a', 'book', 'txt')
    expect(await replaceLocalDraft(key, null, record(key, 'first'), () => true)).toBe(true)
    expect(await readLocalDraft(key)).toMatchObject({ token: 'first' })
    expect(await replaceLocalDraft(key, null, record(key, 'stale'), () => true)).toBe(false)
    expect(await replaceLocalDraft(key, 'stale', null, () => true)).toBe(false)
    expect(await replaceLocalDraft(key, 'first', null, () => true)).toBe(true)
    expect(await readLocalDraft(key)).toBeUndefined()
  })

  it('refuses a ninth account draft and leaves other accounts alone', async () => {
    const fake = fakeIndexedDb(); vi.stubGlobal('indexedDB', fake.indexedDB)
    for (let index = 0; index < 8; index++) {
      const key = draftKey('a', String(index), 'txt'); fake.records.set(key, record(key, String(index)))
    }
    const full = draftKey('a', 'ninth', 'txt')
    await expect(replaceLocalDraft(full, null, record(full, 'new'), () => true)).rejects.toThrow()
    const other = draftKey('b', 'book', 'txt')
    expect(await replaceLocalDraft(other, null, record(other, 'other'), () => true)).toBe(true)
    expect(fake.records.size).toBe(9)
  })

  it('reports blocked storage and quota failures', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb({ blocked: true }).indexedDB)
    await expect(readLocalDraft('key')).rejects.toThrow()
    vi.stubGlobal('indexedDB', fakeIndexedDb({ quota: true }).indexedDB)
    const key = draftKey('a', 'book', 'txt')
    await expect(replaceLocalDraft(key, null, record(key, 'one'), () => true)).rejects.toThrow()
  })
})
