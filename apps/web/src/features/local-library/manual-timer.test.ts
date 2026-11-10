import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook } from '@bookdock/shared'

import { useAuthStore } from '@/stores/auth.store'

import { createLocalManualTimer } from './manual-timer'
import { LocalLibraryRepository } from './repository'

const base = Date.parse('2026-11-07T00:00:00Z')
const ref = { scope: { kind: 'local' as const, vaultId: 'manual-vault' }, bookId: 'same-book' }
const book: ClientBook = { ref, title: 'Book', authors: [], format: 'epub', content: { book: ref, contentId: 'revision' }, availability: 'available', size: 3, createdAt: 1, updatedAt: 1, version: 0 }
const position = { cfi: null, fraction: 0.1, revisionId: 'revision' }
let repository: LocalLibraryRepository
const controllers: ReturnType<typeof createLocalManualTimer>[] = []
const create = () => { const controller = createLocalManualTimer('manual-vault', repository); controllers.push(controller); return controller }

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(base)
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local manual timing must not use HTTP') }))
  localStorage.clear()
  useAuthStore.setState({ user: null })
  repository = new LocalLibraryRepository('manual-timer')
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose()
  await repository.close()
  expect(fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

describe('local adapter for the existing manual state machine', () => {
  it('pauses before mixing positions from another content revision into a measured session', async () => {
    const controller = create()
    await controller.useStore.getState().restore()
    controller.useStore.getState().start(ref.bookId, position)
    vi.setSystemTime(base + 2000)
    controller.useStore.getState().updatePosition(ref.bookId, { cfi: 'new-position', fraction: 0.5, revisionId: 'new-revision' })
    const session = controller.useStore.getState().sessions[ref.bookId]
    expect(session).toMatchObject({ phase: 'paused', revisionId: 'revision', lastCfi: null, lastFraction: 0.1, elapsedMs: 2000 })
    await controller.flush()
  })

  it('restores explicit subsecond pauses without counting time away or service-account ownership', async () => {
    const first = create()
    await first.useStore.getState().restore()
    first.useStore.getState().start(ref.bookId, position)
    vi.setSystemTime(base + 250)
    first.useStore.getState().pause(ref.bookId)
    await first.flush()
    first.dispose()
    vi.setSystemTime(base + 86400_000)
    useAuthStore.setState({ user: { id: 'service-account', username: 'service', role: 'member' } })
    const restored = create()
    await restored.useStore.getState().restore()
    expect(restored.useStore.getState().sessions[ref.bookId]).toMatchObject({ book: ref, phase: 'paused', elapsedMs: 250 })
    expect(restored.useStore.getState().sessions[ref.bookId].userId).toBeUndefined()
    restored.useStore.getState().resume(ref.bookId)
    vi.setSystemTime(base + 86402_000)
    restored.useStore.getState().terminate(ref.bookId)
    await restored.flush()
    const sessions = (await repository.readReadingLedger('manual-vault')).sessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0].durationSeconds).toBe(2.25)
    expect(sessions[0].capture.book).toEqual(ref)
    expect(await repository.listManualTimerSnapshots('manual-vault')).toEqual([])
  })
  it('retains the durable recovery snapshot after failed finalization and retries exactly once', async () => {
    const controller = create()
    await controller.useStore.getState().restore()
    controller.useStore.getState().start(ref.bookId, position)
    vi.setSystemTime(base + 2000)
    controller.useStore.getState().pause(ref.bookId)
    await controller.flush()
    const fault = vi.spyOn(repository, 'enqueueReadingCaptureGroup').mockRejectedValue(new DOMException('Full', 'QuotaExceededError'))
    controller.useStore.getState().terminate(ref.bookId)
    await expect(controller.flush()).rejects.toThrow()
    expect(await repository.listManualTimerSnapshots('manual-vault')).toHaveLength(1)
    expect(controller.useStore.getState().storageError).toBe(true)
    expect((await repository.readReadingLedger('manual-vault')).sessions).toEqual([])
    fault.mockRestore()
    await controller.flush()
    await controller.flush()
    expect((await repository.readReadingLedger('manual-vault')).sessions.map((entry) => entry.durationSeconds)).toEqual([2])
    expect(await repository.listManualTimerSnapshots('manual-vault')).toEqual([])
  })
})
