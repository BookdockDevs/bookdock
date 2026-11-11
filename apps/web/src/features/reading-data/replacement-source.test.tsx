import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBookRef } from '@bookdock/shared'

import { apiGet, apiPost } from '@/api/client'
import { useBookReplacements, useCreateReplacement, useSetReplacementOverride } from '@/api/hooks/useReplacements'
import { LocalReaderContext, type LocalReaderSession } from './reader-source-context'

// Hoisted so the mock factory below can reference it: mocked modules may load during the
// factory call, which happens before a plain `const` in this file is initialised.
const { authState } = vi.hoisted(() => ({
  authState: { user: null } as { user: { id: string; privateLibraryId: string } | null },
}))
vi.mock('@/stores/auth.store', () => {
  const useAuthStore = (selector: (state: typeof authState) => unknown) => selector(authState)
  return { useAuthStore: Object.assign(useAuthStore, { getState: () => authState, subscribe: () => () => {} }), getAuthSessionRevision: () => 0 }
})

const { readReplacements, readReplacementOverrides, mutateReplacement, overrideReplacement } = vi.hoisted(() => ({
  readReplacements: vi.fn(async () => ({ data: [{ id: 'rule-from-vault' }] })),
  readReplacementOverrides: vi.fn(async () => ({}) as Record<string, boolean>),
  mutateReplacement: vi.fn(async () => undefined),
  overrideReplacement: vi.fn(async () => undefined),
}))
vi.mock('@/features/local-library/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/local-library/repository')>()
  return { ...actual, localLibraryRepository: { ...actual.localLibraryRepository, readReplacements, readReplacementOverrides, mutateReplacement, overrideReplacement } }
})

vi.mock('@/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}))

const deviceRef: ClientBookRef = { scope: { kind: 'local', vaultId: 'device-vault' }, bookId: 'device-book' }
const serverRef: ClientBookRef = { scope: { kind: 'remote', connectionId: 'conn', accountId: 'reader' }, bookId: 'server-book' }

function sessionFor(ref: ClientBookRef) {
  return { ref, namespace: `local:${ref.scope.kind}` } as unknown as LocalReaderSession
}

function wrapper(client: QueryClient, ref?: ClientBookRef) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      {ref ? <LocalReaderContext.Provider value={sessionFor(ref)}>{children}</LocalReaderContext.Provider> : children}
    </QueryClientProvider>
  )
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
}

describe('replacement rule ownership', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset()
    vi.mocked(apiGet).mockResolvedValue({ data: [{ id: 'rule-from-server' }] } as never)
    vi.mocked(apiPost).mockReset()
    vi.mocked(apiPost).mockResolvedValue({ data: { id: 'created' } } as never)
    readReplacements.mockClear()
    readReplacementOverrides.mockClear()
    mutateReplacement.mockClear()
    overrideReplacement.mockClear()
    authState.user = null
  })

  it('reads a device book from the vault for a guest without any request', async () => {
    const { result } = renderHook(() => useBookReplacements('device-book'), { wrapper: wrapper(client(), deviceRef) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(readReplacements).toHaveBeenCalledWith('device-vault', 'device-book')
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('merges the account globals into a device book while signed in', async () => {
    authState.user = { id: 'reader', privateLibraryId: 'lib-1' }
    vi.mocked(apiGet).mockResolvedValue({ data: [
      { id: 'account-global', bookId: null, enabled: true },
      { id: 'other-book-rule', bookId: 'another-book', enabled: true },
    ] } as never)
    readReplacements.mockResolvedValue({ data: [
      { id: 'vault-global', bookId: null, enabled: true },
      { id: 'device-own', bookId: 'device-book', enabled: true },
    ] } as never)
    readReplacementOverrides.mockResolvedValue({ 'account-global': false })

    const { result } = renderHook(() => useBookReplacements('device-book'), { wrapper: wrapper(client(), deviceRef) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // The account owns the global set; only this device book's own rules come
    // from the vault. The regression: asking the server for the device book id
    // returned BOOK_NOT_FOUND and left every such reader with no rules.
    expect(apiGet).toHaveBeenCalledWith('/replacements')
    expect(result.current.data?.data.map((row) => row.id)).toEqual(['account-global', 'device-own'])
    expect(result.current.data?.data[0]).toMatchObject({ hasOverride: true, effectiveEnabled: false })
  })

  it('falls back to the device copy when the account cannot be reached', async () => {
    authState.user = { id: 'reader', privateLibraryId: 'lib-1' }
    vi.mocked(apiGet).mockRejectedValue(new Error('offline'))
    readReplacements.mockResolvedValue({ data: [{ id: 'device-own', bookId: 'device-book', enabled: true }] } as never)

    const { result } = renderHook(() => useBookReplacements('device-book'), { wrapper: wrapper(client(), deviceRef) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // Reading a device book offline must still work: the account half is a
    // refresh, not a prerequisite.
    expect(result.current.data?.data.map((row) => row.id)).toEqual(['device-own'])
  })

  it('writes a global rule to the account even from a device book', async () => {
    authState.user = { id: 'reader', privateLibraryId: 'lib-1' }
    const { result } = renderHook(() => useCreateReplacement(), { wrapper: wrapper(client(), deviceRef) })
    await result.current.mutateAsync({ pattern: 'x', bookId: null })
    // One set of global rules: the account holds it, the device does not get a
    // divergent copy just because the reader happens to be on a device book.
    expect(apiPost).toHaveBeenCalledWith('/replacements', { pattern: 'x', bookId: null })
    expect(mutateReplacement).not.toHaveBeenCalled()
  })

  it('writes a rule bound to a device book into that device', async () => {
    authState.user = { id: 'reader', privateLibraryId: 'lib-1' }
    const { result } = renderHook(() => useCreateReplacement(), { wrapper: wrapper(client(), deviceRef) })
    await result.current.mutateAsync({ pattern: 'x', bookId: 'device-book' })
    expect(mutateReplacement).toHaveBeenCalledWith('device-vault', expect.any(String), expect.objectContaining({ create: expect.objectContaining({ bookId: 'device-book' }) }))
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('keeps a per-book override on the device that holds the book', async () => {
    authState.user = { id: 'reader', privateLibraryId: 'lib-1' }
    vi.mocked(apiGet).mockResolvedValue({ data: [{ id: 'account-global', bookId: null, enabled: true, clientVersion: 4 }] } as never)
    const queryClient = client()
    const read = renderHook(() => useBookReplacements('device-book'), { wrapper: wrapper(queryClient, deviceRef) })
    await waitFor(() => expect(read.result.current.isSuccess).toBe(true))

    const { result } = renderHook(() => useSetReplacementOverride(), { wrapper: wrapper(queryClient, deviceRef) })
    await result.current.mutateAsync({ replacementId: 'account-global', body: { bookId: 'device-book', enabled: false } })
    // The rule is the account's; the "off for this book" switch is this book's,
    // so it is stored beside the book and versioned against the rule it mirrors.
    expect(overrideReplacement).toHaveBeenCalledWith('device-vault', 'account-global', 'device-book', false, 4)
  })

  it('reads a server book from the account while signed in', async () => {
    authState.user = { id: 'reader', privateLibraryId: 'lib-1' }
    const { result } = renderHook(() => useBookReplacements('server-book'), { wrapper: wrapper(client(), serverRef) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiGet).toHaveBeenCalledWith('/replacements?bookId=server-book')
    expect(readReplacements).not.toHaveBeenCalled()
  })

  it('asks the account for a server book even for a guest', async () => {
    const { result } = renderHook(() => useBookReplacements('server-book'), { wrapper: wrapper(client()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // The book is the server's, so its rules are too. The device vault is not a
    // stand-in for an account this session does not have.
    expect(apiGet).toHaveBeenCalledWith('/replacements?bookId=server-book')
    expect(readReplacements).not.toHaveBeenCalled()
  })

  it('uses the book ref when the section is rendered outside the reader', async () => {
    const { result } = renderHook(() => useBookReplacements('device-book', deviceRef), { wrapper: wrapper(client()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // No reader context: the ref alone still routes this book's rules home.
    expect(readReplacements).toHaveBeenCalledWith('device-vault', 'device-book')
    expect(apiGet).not.toHaveBeenCalled()
  })
})
