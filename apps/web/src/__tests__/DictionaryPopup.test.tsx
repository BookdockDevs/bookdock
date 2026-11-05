import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DictionaryList } from '@bookdock/shared'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('../api/client', async (original) => ({ ...await original<typeof import('../api/client')>(), apiGet: vi.fn() }))
vi.mock('../features/reader/components/DictionaryDefinition', () => ({ default: ({ html, onNavigate }: { html: string; onNavigate: (word: string) => void }) => <div>{html}<button onClick={() => onNavigate('child')}>entry-link</button></div> }))

import { apiGet } from '../api/client'
import DictionaryPopup from '../features/reader/components/DictionaryPopup'
import { useReaderState } from '../features/reader/state/reader-state'
import { useAuthStore } from '../stores/auth.store'

const list: DictionaryList = { items: [{ id: 'first', name: 'First dictionary', enabled: true, size: 1000, fileNames: ['first.mdx'], createdAt: 1 }, { id: 'second', name: 'Second dictionary', enabled: true, size: 1000, fileNames: ['second.mdx'], createdAt: 2 }], lastUsedId: 'second' }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><DictionaryPopup target={{ text: 'hello', cfiRange: 'cfi', rect: { left: 100, top: 300, width: 100, height: 30 } }} /></QueryClientProvider>)
}
beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: { id: 'reader', username: 'Reader', role: 'member' } })
  useReaderState.setState({ dictionaryTarget: { text: 'hello', cfiRange: 'cfi' } })
  vi.mocked(apiGet).mockImplementation(async (path) => ({ data: path === '/dictionaries' ? list : { query: 'hello', headword: 'hello', html: path.includes('first') ? 'First definition' : 'Second definition' } }) as never)
})
describe('dictionary reader card', () => {
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
