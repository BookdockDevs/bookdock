import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook, ClientBookRef } from '@bookdock/shared'

import { useReadingSummary } from '@/api/hooks/reading-records'
import { useAuthStore } from '@/stores/auth.store'

import { LocalLibraryRepository } from '../local-library/repository'
import { VaultAvailabilityContext } from './vault-availability'

const apiGet = vi.fn()
vi.mock('@/api/client', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  apiUpload: vi.fn(),
}))

const scope = { kind: 'local' as const, vaultId: 'vault' }
const ref = (id: string): ClientBookRef => ({ scope, bookId: id })
const book = (id: string): ClientBook => ({ ref: ref(id), content: { book: ref(id), contentId: 'revision' }, title: id, authors: [], format: 'epub', availability: 'available', size: 1, version: 0, createdAt: 1, updatedAt: 1 })

vi.mock('../local-library/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../local-library/catalog')>()
  return { ...actual, deviceCatalogOperations: () => actual.localCatalogOperations(scope, repository) }
})

let repository: LocalLibraryRepository
let client: QueryClient

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  repository = new LocalLibraryRepository('vault-projection-failure')
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useAuthStore.setState({ user: { id: 'reader-1', username: 'Reader', role: 'owner' } })
})

afterEach(async () => {
  cleanup()
  client.clear()
  await repository.close()
  useAuthStore.setState({ user: null })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <VaultAvailabilityContext.Provider value={true}>{children}</VaultAvailabilityContext.Provider>
    </QueryClientProvider>
  )
}

describe('reading projections on a failed server read', () => {
  it('surfaces the failure when the device half holds nothing', async () => {
    // An empty vault means these numbers are the server's. Reporting zeros
    // would read as "all my reading vanished" instead of "the server is down".
    apiGet.mockRejectedValue(new Error('HTTP 500'))
    const { result } = renderHook(() => useReadingSummary('2026-11-01', '2026-11-09', 'UTC'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('falls back to the device half once it holds reading time', async () => {
    await repository.addBook(book('First'), new Blob(['x']))
    await repository.addReadingEntry({
      capture: { book: ref('First'), source: 'retroactive', requestId: 'First', date: '2026-11-07', startedAt: null, durationSeconds: 90 },
      finished: false,
    })
    apiGet.mockRejectedValue(new Error('HTTP 500'))
    const { result } = renderHook(() => useReadingSummary('2026-11-07', '2026-11-07', 'UTC'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.totalSeconds).toBe(90)
  })
})
