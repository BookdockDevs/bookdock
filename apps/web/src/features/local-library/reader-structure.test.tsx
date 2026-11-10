import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChapterListRes, ClientBook } from '@bookdock/shared'

import { apiGet } from '@/api/client'

import { localEpubProvider } from '../reader/content/local-epub-provider'
import { useBookChapters } from '../reader/hooks/useBookChapters'
import { LocalReaderContext, type LocalReaderSession } from '../reading-data/reader-source-context'
import { openLocalReaderSession } from './reader-session'
import { localLibraryRepository as repository } from './repository'

vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), apiGet: vi.fn() }))
vi.mock('../reader/content/load-engine', () => ({ loadFoliateEngine: async () => ({}) }))
vi.mock('../reader/content/local-epub-provider', () => ({ localEpubProvider: vi.fn() }))

const ref = { scope: { kind: 'local' as const, vaultId: 'device' }, bookId: 'same-id' }
const book: ClientBook = { ref, title: 'Device book', authors: [], format: 'epub', content: { book: ref, contentId: 'content' }, availability: 'available', size: 3, createdAt: 1, updatedAt: 1, version: 0 }
let client: QueryClient
let session: LocalReaderSession | null
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}><LocalReaderContext.Provider value={session}>{children}</LocalReaderContext.Provider></QueryClientProvider>
}
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  session = null
  vi.mocked(apiGet).mockReset(); vi.mocked(localEpubProvider).mockReset()
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => { cleanup(); client.clear(); await repository.close(); vi.unstubAllGlobals() })

describe('source-owned reader structure', () => {
  it('adapts actual local sections without server offsets, fabricated word counts or same-ID remote cache changes', async () => {
    const remote = { data: [{ id: 'server-chapter', title: 'Remote', level: 1, startOffset: 0, endOffset: 30 }] }
    client.setQueryData(['chapters', ref.bookId], remote)
    const release = vi.fn()
    vi.mocked(localEpubProvider).mockReturnValue({ cacheIdentity: 'content', open: async () => ({ book: {
      sections: [{ id: 'one.xhtml', size: 3000 }, { id: 'two.xhtml' }],
      toc: [{ label: 'First chapter', href: 'one.xhtml' }],
      resolveHref: () => ({ index: 0 }),
    }, release }) })
    session = await openLocalReaderSession(ref)
    const { result } = renderHook(() => useBookChapters(ref.bookId), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toHaveLength(2)
    expect(result.current.data?.data[0]).toMatchObject({ id: 'one.xhtml', href: 'one.xhtml', title: 'First chapter', startOffset: null, endOffset: null })
    expect(result.current.data?.data[0]).not.toHaveProperty('wordCount')
    expect(result.current.data?.data[1]).toMatchObject({ href: 'two.xhtml', startOffset: null, endOffset: null })
    expect(client.getQueryData(['chapters', ref.bookId])).toBe(remote)
    expect(client.getQueryState(['chapters', ref.bookId])?.isInvalidated).toBe(false)
    expect(apiGet).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })

  it('retains the remote endpoint, query key and actual chapter facts', async () => {
    const response: ChapterListRes = { data: [{ id: 'server-chapter', title: 'Remote', level: 2, startOffset: 100, endOffset: 300, contentStartOffset: 120, wordCount: 80 }] }
    vi.mocked(apiGet).mockResolvedValue(response)
    const { result } = renderHook(() => useBookChapters(ref.bookId), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/books\/same-id\/chapters/))
    expect(result.current.data).toBe(response)
    expect(client.getQueryData(['chapters', ref.bookId])).toBe(response)
    expect(localEpubProvider).not.toHaveBeenCalled()
  })
})
