import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TtsSettingsSection from '@/features/settings/components/TtsSettingsSection'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
let client: QueryClient
beforeEach(() => {
  useAuthStore.getState().setAuth({ id: 'first', username: 'first', role: 'member' })
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }))))
})
afterEach(() => { cleanup(); client.clear(); useAuthStore.getState().clearAuth(); vi.unstubAllGlobals() })

function mount() { return render(<QueryClientProvider client={client}><TtsSettingsSection /></QueryClientProvider>) }
async function openDraft() {
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByText('settings.ttsAdd'))
}

describe('speech service management account drafts', () => {
  it('clears secret input and closes the old account form before another account can submit it', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify({ data: String(url).endsWith('/providers') ? [{ id: 'openai', kind: 'openai-compatible', defaultBaseUrl: 'https://example.test', defaultModel: null }] : [] })))
    const view = mount()
    await openDraft()
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }))
    fireEvent.change(screen.getByLabelText('settings.ttsName'), { target: { value: 'Private draft' } })
    const secret = view.container.ownerDocument.querySelector('input[type="password"]')!
    fireEvent.change(secret, { target: { value: 'disposable-secret' } })
    act(() => useAuthStore.getState().setAuth({ id: 'next', username: 'next', role: 'member' }))
    await waitFor(() => expect(screen.queryByLabelText('settings.ttsName')).not.toBeInTheDocument())
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(vi.mocked(fetch).mock.calls.every(([, request]) => !request?.method || request.method === 'GET')).toBe(true)
    fireEvent.click(screen.getByText('settings.ttsAdd'))
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }))
    expect(screen.getByLabelText('settings.ttsName')).not.toHaveValue('Private draft')
    expect(document.querySelector('input[type="password"]')).toHaveValue('')
  })
})
