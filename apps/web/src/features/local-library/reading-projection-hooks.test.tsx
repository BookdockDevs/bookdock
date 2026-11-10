import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook } from '@bookdock/shared'

import { useBookReadingLedgerStats, useBookReadingRecords, useBookReadingSessions, useDeleteSession, useReadingLedger, useReadingLedgerRecovery, useUpdateSession } from '@/api/hooks/reading-records'

import { LocalReaderContext, type LocalReaderSession } from '../reading-data/reader-source-context'
import { openLocalReaderSession } from './reader-session'
import { localLibraryRepository as repository } from './repository'

const ref = { scope: { kind: 'local' as const, vaultId: 'projection-hooks' }, bookId: 'same-id' }
const book: ClientBook = { ref, content: { book: ref, contentId: 'revision' }, title: 'Local book', authors: [], format: 'epub', availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }
let client: QueryClient
let local: LocalReaderSession
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><LocalReaderContext.Provider value={local}>{children}</LocalReaderContext.Provider></QueryClientProvider>
const add = (id: string) => repository.writeReadingSession({ book: ref, requestId: id, source: 'retroactive', date: '2026-11-07', durationSeconds: 90, startedAt: null })
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local reading queries must not use HTTP') }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onlineManager.setOnline(false)
  await repository.addBook(book, new Blob(['abc']))
  local = await openLocalReaderSession(ref)
})
afterEach(async () => { cleanup(); client.clear(); await repository.close(); expect(fetch).not.toHaveBeenCalled(); onlineManager.setOnline(true); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('existing reading query hooks with the actual local source', () => {
  it('loads all reading views offline using scoped keys without consuming a same-ID remote cache', async () => {
    await add('local')
    client.setQueryData(['reading-records', 'ledger', 'same-id'], { data: { totalSeconds: 1000 } })
    const { result } = renderHook(() => {
      const ledger = useReadingLedger('same-id')
      const stats = useBookReadingLedgerStats('same-id', undefined, ledger.data?.data.dataVersion)
      const sessions = useBookReadingSessions('same-id', undefined, ledger.data?.data.dataVersion)
      const records = useBookReadingRecords('same-id')
      return { ledger, stats, sessions, records }
    }, { wrapper })
    await waitFor(() => expect(result.current.records.isSuccess && result.current.stats.isSuccess && result.current.sessions.isSuccess && result.current.ledger.isSuccess).toBe(true))
    expect(result.current.ledger.data?.data.totalSeconds).toBe(90)
    expect(result.current.stats.data?.data.totalSeconds).toBe(90)
    expect(result.current.records.data?.data.records).toEqual([{ date: '2026-11-07', durationSeconds: 90 }])
    expect(result.current.sessions.data?.pages[0].data.items).toHaveLength(1)
    expect(client.getQueryData(['reading-records', 'ledger', 'same-id'])).toEqual({ data: { totalSeconds: 1000 } })
    expect(client.getQueryCache().getAll().filter((query) => query.queryKey.includes(local.namespace))).toHaveLength(6)
  })
  it('uses logical pagination with version/scope/range cursors and refuses stale or foreign pages', async () => {
    for (let index = 0; index < 51; index++) await add(`entry-${index}`)
    const first = (await local.getReadingSessions()).data
    expect(first.items).toHaveLength(50)
    expect(first.hasMore).toBe(true)
    const second = (await local.getReadingSessions(undefined, first.nextCursor!)).data
    expect(second.items).toHaveLength(1)
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(51)
    await expect(local.getReadingSessions({ from: '2026-11-01' }, first.nextCursor!)).rejects.toMatchObject({ category: 'conflict' })
    await add('new-fact')
    await expect(local.getReadingSessions(undefined, first.nextCursor!)).rejects.toMatchObject({ category: 'conflict' })
    await expect(local.getReadingSessions(undefined, 'bad-json')).rejects.toMatchObject({ category: 'invalid-input' })
  })
  it('deletes only the displayed local session offline and refuses unversioned same-ID commands', async () => {
    await add('delete')
    const displayed = (await local.getReadingSessions()).data.items[0]
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteSession(), { wrapper })
    await act(async () => { await expect(result.current.mutateAsync(displayed.id)).rejects.toThrow('Displayed local reading versions are required') })
    expect((await local.getReadingSessions()).data.items).toHaveLength(1)
    await act(async () => { await result.current.mutateAsync(displayed) })
    expect((await local.getReadingSessions()).data.items).toEqual([])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reading-records', local.namespace] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['reading-records'] })
  })

  it('edits the displayed local version offline and refuses unversioned or stale same-ID updates', async () => {
    await add('edit')
    const displayed = (await local.getReadingSessions()).data.items[0]
    const { result } = renderHook(() => useUpdateSession(), { wrapper })
    await act(async () => { await expect(result.current.mutateAsync({ id: displayed.id, body: { durationSeconds: 60 } })).rejects.toThrow('Displayed local reading versions are required') })
    await act(async () => { await result.current.mutateAsync({ id: displayed.id, clientMembers: displayed.clientMembers, body: { durationSeconds: 60 } }) })
    expect((await local.getReadingSessions()).data.items[0].durationSeconds).toBe(60)
    await act(async () => { await expect(result.current.mutateAsync({ id: displayed.id, clientMembers: displayed.clientMembers, body: { durationSeconds: 30 } })).rejects.toMatchObject({ category: 'conflict' }) })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('recovers versioned reading queries locally while the network remains offline', async () => {
    await add('recovery')
    const { result } = renderHook(() => useReadingLedgerRecovery('same-id', true), { wrapper })
    await waitFor(() => expect(client.getQueryData(['reading-records', local.namespace, 'ledger', 'same-id'])).toBeDefined())
    await waitFor(() => expect(client.getQueryCache().getAll().filter((query) => query.queryKey.includes(local.namespace) && query.state.status === 'success')).toHaveLength(3))
    expect(result.current.failed).toBe(false)
    act(() => result.current.retry())
    expect(result.current.failed).toBe(false)
  })
})
