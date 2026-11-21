import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'

import { TRANSLATION_MAX_CHARS } from '@bookdock/shared'
import type { AiConfigRes, AiConnectionRes, AiModelEntryRes, TranslationPreferences } from '@bookdock/shared'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('../api/client', async (original) => ({ ...await original<typeof import('../api/client')>(), streamTranslation: vi.fn(), apiPut: vi.fn() }))

import { apiPut, streamTranslation } from '../api/client'
import TranslationContent from '../features/reader/components/TranslationContent'
import { useAuthStore } from '../stores/auth.store'

const preferences: TranslationPreferences = { targetLang: 'zh-Hans', channel: { kind: 'ai', modelId: null } }

function connection(overrides: Partial<AiConnectionRes> = {}): AiConnectionRes {
  return { id: 'first', name: 'First AI', provider: 'ollama', baseUrl: 'http://localhost:11434', availability: 'user', mine: true, apiKeyConfigured: false, createdAt: 1, updatedAt: 1, ...overrides }
}

function model(overrides: Partial<AiModelEntryRes> = {}): AiModelEntryRes {
  return { id: 'first-model', connectionId: 'first', connectionName: 'First AI', provider: 'ollama', upstreamModelId: 'first-model', name: 'first-model', enabled: true, mine: true, createdAt: 1, updatedAt: 1, ...overrides }
}

const config: AiConfigRes = {
  connections: [connection(), connection({ id: 'second', name: 'Second AI', provider: 'openai', baseUrl: 'https://example.test', apiKeyConfigured: true })],
  models: [model(), model({ id: 'second-model', connectionId: 'second', connectionName: 'Second AI', provider: 'openai', upstreamModelId: 'second-model', name: 'second-model' })],
  lastUsedModels: { chat: 'second-model', translate: 'second-model' },
  prompts: [],
  modes: [],
  lastUsedConversationSettings: { readingScope: 'to_here', enabledTools: [], assistantModeId: 'assistant' },
}

const noModelConfig: AiConfigRes = { ...config, connections: [], models: [], lastUsedModels: { chat: null, translate: null } }

function mount(saved = preferences, ai = config, bookId: string | undefined = 'book') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><TranslationContent bookId={bookId} text="Original private selection" preferences={saved} config={ai} onClose={vi.fn()} /></QueryClientProvider>)
}

describe('selection translation card', () => {
  beforeEach(() => {
    useAuthStore.getState().setAuth({ id: 'translation-reader', username: 'reader', role: 'member' })
    vi.mocked(apiPut).mockClear()
    vi.mocked(apiPut).mockImplementation(async (_path, body) => ({ data: body }) as never)
    vi.mocked(streamTranslation).mockReset()
    vi.mocked(streamTranslation).mockImplementation(async (_input, _signal, onText) => { onText('翻译结果') })
  })

  it('automatically translates only the selection and never repeats the original in the card', async () => {
    mount()
    expect(await screen.findByText('翻译结果')).toBeInTheDocument()
    expect(screen.queryByText('Original private selection')).not.toBeInTheDocument()
    expect(streamTranslation).toHaveBeenCalledWith({ bookId: 'book', text: 'Original private selection', ...preferences }, expect.any(AbortSignal), expect.any(Function))
    // Following the account default writes nothing back: there is no explicit choice to persist.
    expect(apiPut).not.toHaveBeenCalled()
    expect(screen.queryByText(/translation.followAi/)).not.toBeInTheDocument()
  })

  it('uses the same card for local text without a fabricated book identity', async () => {
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><TranslationContent text="Local selection" preferences={preferences} config={config} onClose={vi.fn()} /></QueryClientProvider>)
    expect(await screen.findByText('翻译结果')).toBeInTheDocument()
    expect(streamTranslation).toHaveBeenCalledWith({ text: 'Local selection', ...preferences }, expect.any(AbortSignal), expect.any(Function))
  })

  it('shows the account requirement without forwarding anonymous text', () => {
    useAuthStore.getState().clearAuth()
    mount()
    expect(screen.getByText('translation.accountRequired')).toBeInTheDocument()
    expect(streamTranslation).not.toHaveBeenCalled()
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('hides and discards an old account stream without forwarding the selection to the new account', async () => {
    let chunk!: (text: string) => void
    vi.mocked(streamTranslation).mockImplementationOnce(async (_input, _signal, onText) => { chunk = onText })
    mount()
    await waitFor(() => expect(chunk).toBeTypeOf('function'))
    act(() => chunk('Old output'))
    expect(screen.getByText('Old output')).toBeInTheDocument()
    act(() => useAuthStore.getState().setAuth({ id: 'next-account', username: 'next', role: 'member' }))
    act(() => chunk('Late output'))
    expect(screen.queryByText('Old output')).not.toBeInTheDocument()
    expect(screen.queryByText(/Late output/)).not.toBeInTheDocument()
    expect(streamTranslation).toHaveBeenCalledOnce()
  })

  it('starts only one provider request during StrictMode remounts', async () => {
    const client = new QueryClient()
    render(<StrictMode><QueryClientProvider client={client}><TranslationContent bookId="book" text="Hello" preferences={preferences} config={config} onClose={vi.fn()} /></QueryClientProvider></StrictMode>)
    await screen.findByText('翻译结果')
    expect(streamTranslation).toHaveBeenCalledOnce()
  })

  it('automatically retranslates after changing the target language', async () => {
    mount()
    await screen.findByText('翻译结果')
    await waitFor(() => expect(screen.getByLabelText('translation.target')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('translation.target'), { target: { value: 'en' } })
    await waitFor(() => expect(streamTranslation).toHaveBeenCalledTimes(2))
    expect(vi.mocked(streamTranslation).mock.calls[1]![0].targetLang).toBe('en')
    expect(apiPut).toHaveBeenCalledWith('/translation/config', { ...preferences, targetLang: 'en' })
  })

  it('stops upstream work, keeps partial text and ignores late chunks', async () => {
    let late: ((text: string) => void) | undefined
    vi.mocked(streamTranslation).mockImplementationOnce(async (_input, signal, onText) => {
      late = onText
      onText('部分译文')
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    })
    mount()
    await screen.findByText('部分译文')
    fireEvent.click(screen.getByRole('button', { name: 'translation.stop' }))
    expect(vi.mocked(streamTranslation).mock.calls[0]![1].aborted).toBe(true)
    act(() => late?.('不应出现'))
    expect(screen.getByText('部分译文')).toBeInTheDocument()
    expect(screen.queryByText(/不应出现/)).not.toBeInTheDocument()
    expect(screen.getByText('translation.stopped')).toBeInTheDocument()
  })

  it('cancels the current request before translating into a newly selected language', async () => {
    let late: ((text: string) => void) | undefined
    vi.mocked(streamTranslation).mockImplementationOnce(async (_input, signal, onText) => {
      late = onText
      onText('旧译文')
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    })
    mount()
    await screen.findByText('旧译文')
    await waitFor(() => expect(screen.getByLabelText('translation.target')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('translation.target'), { target: { value: 'en' } })
    await screen.findByText('翻译结果')
    expect(vi.mocked(streamTranslation).mock.calls[0]![1].aborted).toBe(true)
    expect(vi.mocked(streamTranslation).mock.calls[1]![0].targetLang).toBe('en')
    act(() => late?.('迟到的旧译文'))
    expect(screen.queryByText(/迟到/)).not.toBeInTheDocument()
  })

  it('cancels on unmount and automatically truncates oversized selections', async () => {
    vi.mocked(streamTranslation).mockImplementationOnce(async (_input, signal) => await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })))
    const view = mount()
    await waitFor(() => expect(streamTranslation).toHaveBeenCalledOnce())
    view.unmount()
    expect(vi.mocked(streamTranslation).mock.calls[0]![1].aborted).toBe(true)
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><TranslationContent bookId="book" text={'x'.repeat(TRANSLATION_MAX_CHARS + 1)} preferences={preferences} config={config} onClose={vi.fn()} /></QueryClientProvider>)
    await waitFor(() => expect(streamTranslation).toHaveBeenCalledTimes(2))
    expect(vi.mocked(streamTranslation).mock.calls[1]![0].text).toHaveLength(TRANSLATION_MAX_CHARS)
  })

  it('restores the last selected model and language instead of choosing the first service again', async () => {
    const saved: TranslationPreferences = { targetLang: 'ja', channel: { kind: 'ai', modelId: 'second-model' } }
    mount(saved)
    await screen.findByText('翻译结果')
    expect(vi.mocked(streamTranslation).mock.calls[0]![0]).toMatchObject(saved)
    expect(screen.getByLabelText('translation.target')).toHaveValue('ja')
    expect(screen.getByLabelText('translation.channel')).toHaveValue('second-model')
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('shows configuration guidance without sending translation requests when no AI service exists', () => {
    mount(preferences, noModelConfig)
    expect(screen.getByText('translation.notConfigured')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'translation.configure' })).toHaveAttribute('href', '/settings?section=reading&focus=ai')
    expect(screen.getByLabelText('translation.channel')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'translation.retry' })).toBeDisabled()
    expect(streamTranslation).not.toHaveBeenCalled()
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('shows not configured state without erroring when every model of the connection is deleted', () => {
    const saved: TranslationPreferences = { targetLang: 'en', channel: { kind: 'ai', modelId: 'gemma-4-31b-it' } }
    const connectionWithoutModels: AiConfigRes = { ...config, connections: [connection()], models: [], lastUsedModels: { chat: null, translate: null } }
    mount(saved, connectionWithoutModels)
    expect(screen.getByText('translation.notConfigured')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'translation.configure' })).toHaveAttribute('href', '/settings?section=reading&focus=ai')
    expect(screen.getByLabelText('translation.channel')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'translation.retry' })).toBeDisabled()
    expect(streamTranslation).not.toHaveBeenCalled()
  })

  it('offers only enabled models in the channel picker', async () => {
    const withDisabled: AiConfigRes = {
      ...config,
      models: [...config.models, model({ id: 'off-model', upstreamModelId: 'off-model', name: 'off-model', enabled: false })],
    }
    mount({ targetLang: 'zh-Hans', channel: { kind: 'ai', modelId: 'second-model' } }, withDisabled)
    expect(await screen.findByText('翻译结果')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'second-model' })).toBeInTheDocument()
    // A switched-off model of your own is manageable in settings, not runnable here.
    expect(screen.queryByRole('option', { name: 'off-model' })).toBeNull()
  })

  it('treats a deleted model selection as absent and still translates through the chain', async () => {
    const saved: TranslationPreferences = { targetLang: 'zh-Hans', channel: { kind: 'ai', modelId: 'deleted-model' } }
    mount(saved)
    expect(await screen.findByText('翻译结果')).toBeInTheDocument()
    // The picker shows the empty state; the server-side chain picks the model.
    expect(screen.getByText('translation.selectModel')).toBeInTheDocument()
    expect(streamTranslation).toHaveBeenCalledWith(
      { bookId: 'book', text: 'Original private selection', ...saved },
      expect.any(AbortSignal),
      expect.any(Function),
    )
  })
})
