import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'

import type { AiConfigRes, AiProfileRes, TranslationPreferences } from '@bookdock/shared'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('../api/client', async (original) => ({ ...await original<typeof import('../api/client')>(), streamTranslation: vi.fn(), apiPut: vi.fn() }))

import { apiPut, streamTranslation } from '../api/client'
import TranslationContent from '../features/reader/components/TranslationContent'

const preferences: TranslationPreferences = { targetLang: 'zh-Hans', channel: { kind: 'ai', profileId: null, model: null } }
const firstProfile: AiProfileRes = { id: 'first', name: 'First AI', provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'first-model', models: [{ id: 'first-model', name: 'first-model' }], embeddingModel: null, embeddingModels: [], apiKeyConfigured: false, createdAt: 1, updatedAt: 1 }
const firstPreferences: TranslationPreferences = { ...preferences, channel: { kind: 'ai', profileId: 'first', model: null } }
const config: AiConfigRes = {
  activeProfileId: 'second', profiles: [firstProfile, { ...firstProfile, id: 'second', name: 'Second AI', model: 'second-model', models: [{ id: 'second-model', name: 'second-model' }] }], provider: 'openai', baseUrl: 'https://example.test', model: 'second-model', models: [],
  prompts: [], modes: [], lastUsedConversationSettings: { readingScope: 'to_here', enabledTools: [], assistantModeId: 'assistant' },
  embeddingProfileId: null, embeddingProvider: null, embeddingModel: null, embeddingModels: [], embeddingConfigured: false,
  apiKeyConfigured: true, configuredByUser: true,
}

function mount(saved = preferences, ai = config) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><TranslationContent bookId="book" text="Original private selection" preferences={saved} config={ai} onClose={vi.fn()} /></QueryClientProvider>)
}

describe('selection translation card', () => {
  beforeEach(() => {
    vi.mocked(apiPut).mockClear()
    vi.mocked(apiPut).mockImplementation(async (_path, body) => ({ data: body }) as never)
    vi.mocked(streamTranslation).mockReset()
    vi.mocked(streamTranslation).mockImplementation(async (_input, _signal, onText) => { onText('翻译结果') })
  })

  it('automatically translates only the selection and never repeats the original in the card', async () => {
    mount()
    expect(await screen.findByText('翻译结果')).toBeInTheDocument()
    expect(screen.queryByText('Original private selection')).not.toBeInTheDocument()
    expect(streamTranslation).toHaveBeenCalledWith({ bookId: 'book', text: 'Original private selection', ...firstPreferences }, expect.any(AbortSignal), expect.any(Function))
    expect(apiPut).toHaveBeenCalledWith('/translation/config', firstPreferences)
    expect(screen.queryByText(/translation.followAi/)).not.toBeInTheDocument()
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
    expect(apiPut).toHaveBeenCalledWith('/translation/config', { ...firstPreferences, targetLang: 'en' })
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
    render(<QueryClientProvider client={client}><TranslationContent bookId="book" text={'x'.repeat(6001)} preferences={preferences} config={config} onClose={vi.fn()} /></QueryClientProvider>)
    await waitFor(() => expect(streamTranslation).toHaveBeenCalledTimes(2))
    expect(vi.mocked(streamTranslation).mock.calls[1]![0].text).toHaveLength(6000)
  })

  it('restores the last selected service, model and language instead of choosing the first service again', async () => {
    const saved: TranslationPreferences = { targetLang: 'ja', channel: { kind: 'ai', profileId: 'second', model: 'second-model' } }
    mount(saved)
    await screen.findByText('翻译结果')
    expect(vi.mocked(streamTranslation).mock.calls[0]![0]).toMatchObject(saved)
    expect(screen.getByLabelText('translation.target')).toHaveValue('ja')
    expect(screen.getByLabelText('translation.channel')).toHaveValue(JSON.stringify(['second', null]))
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('shows configuration guidance without sending translation requests when no AI service exists', () => {
    mount(preferences, { ...config, profiles: [] })
    expect(screen.getByText('translation.notConfigured')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'translation.configure' })).toHaveAttribute('href', '/settings?section=reading&focus=ai')
    expect(screen.getByLabelText('translation.channel')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'translation.retry' })).toBeDisabled()
    expect(streamTranslation).not.toHaveBeenCalled()
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('shows not configured state without erroring when all models in profile are deleted', () => {
    const emptyModelsProfile: AiProfileRes = { ...firstProfile, model: null, models: [] }
    const saved: TranslationPreferences = { targetLang: 'en', channel: { kind: 'ai', profileId: 'first', model: 'gemma-4-31b-it' } }
    mount(saved, { ...config, profiles: [emptyModelsProfile] })
    expect(screen.getByText('translation.notConfigured')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'translation.configure' })).toHaveAttribute('href', '/settings?section=reading&focus=ai')
    expect(screen.getByLabelText('translation.channel')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'translation.retry' })).toBeDisabled()
    expect(streamTranslation).not.toHaveBeenCalled()
  })

  it('falls back to remaining model when previously selected model was deleted', async () => {
    const saved: TranslationPreferences = { targetLang: 'zh-Hans', channel: { kind: 'ai', profileId: 'first', model: 'deleted-model' } }
    mount(saved)
    expect(await screen.findByText('翻译结果')).toBeInTheDocument()
    expect(streamTranslation).toHaveBeenCalledWith(
      expect.objectContaining({ channel: { kind: 'ai', profileId: 'first', model: null } }),
      expect.any(AbortSignal),
      expect.any(Function),
    )
  })
})
