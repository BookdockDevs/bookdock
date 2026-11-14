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
// The provider menu ignores a re-open within 150 ms of its own close, so two
// scripted opens in a row need that window to pass.
async function openProviderMenu() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)) })
  fireEvent.click(screen.getByRole('button', { name: 'settings.ttsAdd' }))
}
async function openDraft() {
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  await openProviderMenu()
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
    await openProviderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }))
    expect(screen.getByLabelText('settings.ttsName')).not.toHaveValue('Private draft')
    expect(document.querySelector('input[type="password"]')).toHaveValue('')
  })
  it.each([true, false])('only shows the keep-credentials hint for configured services (%s)', async (credentialsConfigured) => {
    vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify({ data: String(url).endsWith('/providers')
      ? [{ id: 'openai', kind: 'openai-compatible', defaultBaseUrl: 'https://example.test', defaultModel: null }]
      : [{ id: 'service-1', name: 'Saved voice', provider: 'openai', baseUrl: null, model: null, defaultVoice: null, options: {}, credentialsConfigured, enabled: true, order: 10, availability: 'user', mine: true, createdAt: 1, updatedAt: 1 }] })))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'settings.editModeEnter' }))
    fireEvent.click(await screen.findByRole('button', { name: 'settings.ttsEdit' }))
    expect(Boolean(screen.queryByText('settings.ttsSecretHint'))).toBe(credentialsConfigured)
  })

  it('parks a service through the row switch instead of deleting it', async () => {
    vi.mocked(fetch).mockImplementation(async (url, request) => {
      if (String(url).endsWith('/providers')) return new Response(JSON.stringify({ data: [] }))
      if (request?.method === 'PUT') return new Response(JSON.stringify({ data: null }))
      return new Response(JSON.stringify({ data: [{ id: 'service-1', name: 'Saved voice', provider: 'openai', baseUrl: null, model: null, defaultVoice: null, options: {}, credentialsConfigured: true, enabled: true, order: 10, createdAt: 1, updatedAt: 1 }] }))
    })
    mount()
    fireEvent.click(await screen.findByRole('switch', { name: 'Saved voice' }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, request]) => request?.method === 'PUT')).toBe(true))
    const put = vi.mocked(fetch).mock.calls.find(([, request]) => request?.method === 'PUT')!
    expect(String(put[0])).toContain('/tts/services/service-1')
    expect(JSON.parse(String(put[1]?.body))).toEqual({ enabled: false })
  })

  it('does not show the keep-credentials hint for a new service', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify({ data: String(url).endsWith('/providers') ? [{ id: 'openai', kind: 'openai-compatible', defaultBaseUrl: 'https://example.test', defaultModel: null }] : [] })))
    mount()
    await openDraft()
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }))
    expect(screen.queryByText('settings.ttsSecretHint')).not.toBeInTheDocument()
  })

  it('triggers draft test and cancels form from the dialog footer', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify({ data: String(url).endsWith('/providers') ? [{ id: 'openai', kind: 'openai-compatible', defaultBaseUrl: 'https://example.test', defaultModel: null }] : [] })))
    mount()
    await openDraft()
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }))

    const testBtn = screen.getByRole('button', { name: 'settings.ttsTest' })
    expect(testBtn).toBeInTheDocument()
    fireEvent.click(testBtn)
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, request]) => String(request?.method).toUpperCase() === 'POST')).toBe(true))

    const cancelBtn = screen.getByRole('button', { name: 'common.cancel' })
    expect(cancelBtn).toBeInTheDocument()
    fireEvent.click(cancelBtn)
    await waitFor(() => expect(screen.queryByLabelText('settings.ttsName')).not.toBeInTheDocument())
  })
})
