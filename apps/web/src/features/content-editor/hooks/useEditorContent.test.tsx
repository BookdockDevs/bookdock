import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiClient from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiPut: vi.fn() }
})
vi.mock('@/features/reading-data/catalog-source-context', () => ({ useLocalCatalog: () => null }))

import { useAuthStore } from '@/stores/auth.store'
import { useSaveEditorEpub, useSaveEditorTxt } from './useEditorContent'

const bookId = 'book-1'
const readerEntryKeys = [['book', bookId], ['chapters', bookId], ['progress', bookId, 'user']]
const editorKeys = [['books', 'detail', bookId], ['content-editor', bookId]]
const paintedKeys = [...readerEntryKeys, ...editorKeys]

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('editor save retires the caches it paints from', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user', username: 'user', role: 'owner' } as never })
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    for (const key of paintedKeys) queryClient.setQueryData(key, { data: { revisionId: 'rev-1' } })
  })

  it.each([['TXT', useSaveEditorTxt], ['EPUB', useSaveEditorEpub]] as const)('clears the %s draft before refreshing the saved revision', async (_format, useSave) => {
    let finishClear!: (cleared: boolean) => void
    const clearSavedDraft = vi.fn(() => new Promise<boolean>((resolve) => { finishClear = resolve }))
    vi.mocked(apiClient.apiPut).mockResolvedValue({ data: { revisionId: 'rev-2', changed: true, unlocated: {} } } as never)
    const { result } = renderHook(() => useSave(bookId, undefined, clearSavedDraft), { wrapper: wrapper(queryClient) })

    result.current.mutate({ baseRevisionId: 'rev-1', chapters: [], tocRuleSelection: { ruleId: null, patterns: null, label: null, auto: false } } as never)

    await waitFor(() => expect(clearSavedDraft).toHaveBeenCalledOnce())
    for (const key of paintedKeys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
    finishClear(true)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // The reader can mount from inactive query data before the background refetch.
    for (const key of readerEntryKeys) expect(queryClient.getQueryData(key)).toBeUndefined()
    for (const key of editorKeys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  })

  it('preserves the draft when saving the book fails', async () => {
    const clearSavedDraft = vi.fn(async () => true)
    vi.mocked(apiClient.apiPut).mockRejectedValue(new Error('Save failed'))
    const { result } = renderHook(() => useSaveEditorTxt(bookId, undefined, clearSavedDraft), { wrapper: wrapper(queryClient) })
    result.current.mutate({ baseRevisionId: 'rev-1', chapters: [] })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(clearSavedDraft).not.toHaveBeenCalled()
  })
})
