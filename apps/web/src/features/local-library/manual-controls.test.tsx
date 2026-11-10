import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook } from '@bookdock/shared'

import { LocalReaderContext } from '../reading-data/reader-source-context'
import TimerPill from '../reader/components/TimerPill'
import { localManualTimer } from './manual-timer'
import { openLocalReaderSession } from './reader-session'
import { localLibraryRepository as repository } from './repository'

vi.mock('../reader/hooks/useReaderApi', () => ({ useReaderApi: () => ({ renderer: null }) }))
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

const base = Date.parse('2026-11-07T00:00:37Z')
const ref = { scope: { kind: 'local' as const, vaultId: 'manual-controls' }, bookId: 'book' }
const book: ClientBook = { ref, content: { book: ref, contentId: 'revision' }, title: 'Book', authors: [], format: 'epub', availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }
let serial = 0
let client: QueryClient
beforeEach(async () => {
  ref.scope.vaultId = `manual-controls-${++serial}`
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(base)
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local controls must not send HTTP') }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  onlineManager.setOnline(false)
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => {
  cleanup()
  localManualTimer(ref.scope.vaultId).dispose()
  client.clear()
  await repository.close()
  expect(fetch).not.toHaveBeenCalled()
  onlineManager.setOnline(true)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

describe('existing manual controls with the actual local reader adapter', () => {
  it.each([1250, 86400_500])('saves %s measured milliseconds through the existing offline dialog with failure recovery and finish intent', async (elapsedMs) => {
    const local = await openLocalReaderSession(ref)
    const timer = localManualTimer(ref.scope.vaultId)
    timer.useStore.getState().updatePosition(ref.bookId, { cfi: null, fraction: 0.1, revisionId: 'revision' })
    render(<QueryClientProvider client={client}><LocalReaderContext.Provider value={local}><TimerPill bookId={ref.bookId} /></LocalReaderContext.Provider></QueryClientProvider>)
    const start = screen.getByTitle('reader.manualTimerStart')
    await waitFor(() => expect(start).not.toBeDisabled())
    fireEvent.click(start)
    act(() => vi.setSystemTime(base + elapsedMs))
    const stop = screen.getByTitle('reader.manualTimerTerminate')
    fireEvent.pointerDown(stop)
    fireEvent.pointerUp(stop)
    expect(screen.getByText('reader.manualTimerSaveTitle')).toBeInTheDocument()
    expect(timer.useStore.getState().sessions[ref.bookId].phase).toBe('paused')
    fireEvent.click(screen.getByLabelText('readingData.markFinished'))
    const fault = vi.spyOn(repository, elapsedMs > 86400_000 ? 'addReadingGroupEntry' : 'addReadingEntry').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'))
    const form = screen.getByRole('dialog').querySelector('form')!
    fireEvent.submit(form)
    await screen.findByText('reader.sessionAddFailed')
    expect(timer.useStore.getState().sessions[ref.bookId].phase).toBe('paused')
    expect((await repository.readReadingLedger(ref.scope.vaultId)).sessions).toEqual([])
    const raw = (await repository.listManualTimerSnapshots(ref.scope.vaultId))[0]
    expect(fault.mock.calls[0][0].expectedManualUpdatedAt).toBe(raw.updatedAt)
    expect(raw.phase).toBe('paused')
    const command = fault.mock.calls[0][0]
    expect('capture' in command ? command.capture.requestId : command.group.id).toBe(raw.requestId)
    fireEvent.submit(form)
    await waitFor(() => expect(fault).toHaveBeenCalledTimes(2))
    await expect(fault.mock.results[1].value).resolves.not.toThrow()
    await waitFor(() => expect(screen.queryByText('reader.manualTimerSaveTitle')).not.toBeInTheDocument())
    await timer.flush()
    fault.mockRestore()
    const sessions = (await repository.readReadingLedger(ref.scope.vaultId)).sessions
    expect(sessions).toHaveLength(elapsedMs > 86400_000 ? 2 : 1)
    expect(sessions.reduce((sum, session) => sum + session.durationSeconds, 0)).toBe(elapsedMs / 1000)
    expect(Math.min(...sessions.map((session) => session.capture.startedAt!))).toBe(base)
    expect(Math.max(...sessions.map((session) => session.capture.endedAt!))).toBe(base + elapsedMs)
    if (sessions.length > 1) expect(new Set(sessions.map((session) => session.groupId)).size).toBe(1)
    expect((await repository.getState(ref))?.readStatus).toBe('finished')
    expect(await repository.listManualTimerSnapshots(ref.scope.vaultId)).toEqual([])
    expect(timer.useStore.getState().sessions).toEqual({})
  })
})
