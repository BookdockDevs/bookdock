import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DictionaryList } from '@bookdock/shared'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('../api/client', async (original) => ({ ...await original<typeof import('../api/client')>(), apiGet: vi.fn() }))
vi.mock('../features/reader/components/DictionaryDefinition', () => ({ default: ({ html, onNavigate }: { html: string; onNavigate: (word: string) => void }) => <div>{html}<button onClick={() => onNavigate('child')}>entry-link</button></div> }))

import { apiGet, ApiError } from '../api/client'
import { dictionaryListKey } from '@/api/hooks/useDictionaries'
import { LocalReaderContext, type LocalReaderSession } from '@/features/reading-data/reader-source-context'
import DictionaryPopup from '../features/reader/components/DictionaryPopup'
import { useReaderState } from '../features/reader/state/reader-state'
import { useAuthStore } from '../stores/auth.store'

const list: DictionaryList = { items: [{ id: 'first', name: 'First dictionary', enabled: true, size: 1000, fileNames: ['first.mdx'], createdAt: 1 }, { id: 'second', name: 'Second dictionary', enabled: true, size: 1000, fileNames: ['second.mdx'], createdAt: 2 }], lastUsedId: 'second' }
function mount(local = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><LocalReaderContext.Provider value={local ? { namespace: 'local:device:book', bookId: 'device-book', sourceAvailable: true } as LocalReaderSession : null}><DictionaryPopup target={{ text: 'hello', cfiRange: 'cfi', rect: { left: 100, top: 300, width: 100, height: 30 } }} /></LocalReaderContext.Provider></QueryClientProvider>)
  return { ...view, client }
}
beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: { id: 'reader', username: 'Reader', role: 'member' } })
  useReaderState.setState({ dictionaryTarget: { text: 'hello', cfiRange: 'cfi' } })
  vi.mocked(apiGet).mockImplementation(async (path) => ({ data: path === '/dictionaries' ? list : { query: 'hello', headword: 'hello', html: path.includes('first') ? 'First definition' : 'Second definition' } }) as never)
})
describe('dictionary reader card', () => {
  it('uses the same connected word service for a local book without submitting its identity', async () => {
    mount(true)
    await screen.findByText('Second definition')
    expect(apiGet).toHaveBeenCalledWith('/dictionaries/second/lookup?word=hello', expect.any(AbortSignal))
    expect(vi.mocked(apiGet).mock.calls.every(([path]) => path.startsWith('/dictionaries'))).toBe(true)
    expect(JSON.stringify(vi.mocked(apiGet).mock.calls)).not.toContain('device-book')
  })

  it('explains account requirements without querying or closing local reading', async () => {
    useAuthStore.setState({ user: null })
    mount(true)
    expect(await screen.findByText('dictionary.accountRequired')).toBeInTheDocument()
    expect(apiGet).not.toHaveBeenCalled()
    expect(useReaderState.getState().dictionaryTarget).not.toBeNull()
  })

  it('closes the old account target and never forwards its word or late definition to the next account', async () => {
    let settle!: (value: unknown) => void
    vi.mocked(apiGet).mockImplementation(async (path) => path === '/dictionaries' ? { data: list } as never : await new Promise((resolve) => { settle = resolve }) as never)
    const { client } = mount(true)
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/dictionaries/second/lookup?word=hello', expect.any(AbortSignal)))
    act(() => useAuthStore.getState().setAuth({ id: 'next-account', username: 'Next', role: 'member' }))
    await act(async () => { settle({ data: { query: 'hello', headword: 'hello', html: 'Old private definition' } }) })
    expect(useReaderState.getState().dictionaryTarget).toBeNull()
    expect(screen.queryByText('Old private definition')).not.toBeInTheDocument()
    expect(client.getQueryData(dictionaryListKey('next-account'))).toBeUndefined()
    expect(vi.mocked(apiGet).mock.calls.filter(([path]) => path === '/dictionaries')).toHaveLength(1)
  })

  it('reports service refusal and permits retry without losing the local selection target', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/dictionaries') return { data: list } as never
      throw new ApiError('FORBIDDEN', 'Dictionary is not accessible', 403)
    })
    mount(true)
    expect(await screen.findByText('dictionary.accessRequired')).toBeInTheDocument()
    expect(useReaderState.getState().dictionaryTarget).not.toBeNull()
    vi.mocked(apiGet).mockResolvedValue({ data: { query: 'hello', headword: 'hello', html: 'Recovered definition' } } as never)
    fireEvent.click(screen.getByRole('button', { name: 'dictionary.retry' }))
    expect(await screen.findByText('Recovered definition')).toBeInTheDocument()
  })

  it('uses the remembered enabled dictionary and queries another immediately when selected', async () => {
    mount()
    await screen.findByText('Second definition')
    fireEvent.click(screen.getByRole('button', { name: /Second dictionary/ }))
    fireEvent.click(screen.getByRole('option', { name: /First dictionary/ }))
    await screen.findByText('First definition')
    expect(useReaderState.getState().dictionaryTarget).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'entry-link' }))
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/dictionaries/first/lookup?word=child', expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('button', { name: 'dictionary.back' }))
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/dictionaries/first/lookup?word=hello', expect.any(AbortSignal)))
  })
  it('shows an import entry without querying when no dictionaries are enabled', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { items: [], lastUsedId: null } })
    mount()
    expect(await screen.findByRole('link', { name: 'dictionary.import' })).toHaveAttribute('href', '/settings?section=reading&focus=dictionary')
    expect(vi.mocked(apiGet).mock.calls.every(([path]) => path === '/dictionaries')).toBe(true)
  })
  it('closes on Escape through the shared selection utility shell', async () => {
    mount()
    await screen.findByText('Second definition')
    act(() => fireEvent.keyDown(window, { key: 'Escape' }))
    expect(useReaderState.getState().dictionaryTarget).toBeNull()
  })
})
