import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelectedTextTranslationRequest } from '@bookdock/shared'

import { streamTranslation } from '@/api/client'
import { aiConfigKey, useAiConfig, useActivateAiProfile } from '@/api/hooks/useAi'
import { translationConfigKey, useSaveTranslationConfig, useTranslationConfig } from '@/api/hooks/useTranslationConfig'
import { useAuthStore } from '@/stores/auth.store'

const input: SelectedTextTranslationRequest = { text: 'Explicit selection', targetLang: 'zh-Hans', channel: { kind: 'ai', profileId: null, model: null } }
const account = (id: string) => ({ id, username: id, role: 'member' })
const response = () => new Response('{"type":"delta","text":"translated"}\n{"type":"done"}\n')
let client: QueryClient
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider> }

beforeEach(() => {
  onlineManager.setOnline(true)
  useAuthStore.getState().setAuth(account('first'))
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.stubGlobal('fetch', vi.fn(async () => response()))
})
afterEach(() => { cleanup(); client.clear(); onlineManager.setOnline(true); useAuthStore.getState().clearAuth(); vi.unstubAllGlobals() })

describe('translation connected-account transport', () => {
  it.each([false, true])('routes an explicit selection with remote binding %s and no extra payload', async (remote) => {
    const text = vi.fn()
    const request = remote ? { ...input, bookId: 'genuine-remote-book' } : input
    await streamTranslation(request, new AbortController().signal, text)
    expect(fetch).toHaveBeenCalledWith(remote ? '/api/v1/translation/translate' : '/api/v1/translation/selected-text', expect.objectContaining({ body: JSON.stringify(request), credentials: 'same-origin' }))
    expect(text).toHaveBeenCalledExactlyOnceWith('translated')
  })

  it('refuses anonymous streaming before making a request', async () => {
    useAuthStore.getState().clearAuth()
    await expect(streamTranslation(input, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancels an in-flight body on account change and never emits late chunks', async () => {
    const cancel = vi.fn()
    let producer!: ReadableStreamDefaultController<Uint8Array>
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ start(controller) { producer = controller }, cancel })))
    const chunks = vi.fn()
    const pending = streamTranslation(input, new AbortController().signal, chunks)
    const rejection = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    producer.enqueue(new TextEncoder().encode('{"type":"delta","text":"first"}\n'))
    await vi.waitFor(() => expect(chunks).toHaveBeenCalledExactlyOnceWith('first'))
    useAuthStore.getState().setAuth(account('next'))
    await rejection
    expect(cancel).toHaveBeenCalledOnce()
    expect(chunks).toHaveBeenCalledOnce()
    expect(useAuthStore.getState().user?.id).toBe('next')
  })

  it('discards a late rejected response from an old account and releases its body', async () => {
    let settle!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(async () => await new Promise<Response>((resolve) => { settle = resolve }))
    const chunks = vi.fn()
    const pending = streamTranslation(input, new AbortController().signal, chunks)
    const rejection = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    const cancel = vi.fn()
    useAuthStore.getState().setAuth(account('next'))
    settle(new Response(new ReadableStream({ cancel }), { status: 401 }))
    await rejection
    expect(cancel).toHaveBeenCalledOnce()
    expect(chunks).not.toHaveBeenCalled()
    expect(useAuthStore.getState().user?.id).toBe('next')
  })

  it('does not report truncated or failed provider output as a completed translation', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{"type":"delta","text":"partial"}\n'))
    await expect(streamTranslation(input, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{"type":"error","code":"AI_RATE_LIMITED","message":"limited"}\n'))
    await expect(streamTranslation(input, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' })
  })
})

describe('translation service configuration ownership', () => {
  it('refuses anonymous config refetches without making HTTP requests', async () => {
    useAuthStore.getState().clearAuth()
    const { result } = renderHook(() => ({ translation: useTranslationConfig(), ai: useAiConfig() }), { wrapper })
    await act(async () => { await result.current.translation.refetch(); await result.current.ai.refetch() })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never caches an unabortable old account config response in the next account', async () => {
    const settle: ((response: Response) => void)[] = []
    vi.mocked(fetch).mockImplementation(async () => await new Promise<Response>((resolve) => { settle.push(resolve) }))
    const { result } = renderHook(() => ({ translation: useTranslationConfig(), ai: useAiConfig() }), { wrapper })
    await waitFor(() => expect(settle).toHaveLength(2))
    act(() => useAuthStore.getState().setAuth(account('next')))
    await waitFor(() => expect(settle).toHaveLength(4))
    await act(async () => {
      settle[2]!(new Response(JSON.stringify({ data: { ...input, targetLang: 'en' } })))
      settle[3]!(new Response(JSON.stringify({ data: { profiles: [], model: 'next-model' } })))
      settle[0]!(new Response(JSON.stringify({ data: { ...input, targetLang: 'ja' } })))
      settle[1]!(new Response(JSON.stringify({ data: { profiles: [], model: 'private-old-model' } })))
    })
    await waitFor(() => expect(result.current.ai.data?.data.model).toBe('next-model'))
    expect(result.current.translation.data?.data.targetLang).toBe('en')
    expect(client.getQueryData(aiConfigKey('first'))).toBeUndefined()
    expect(client.getQueryData(translationConfigKey('first'))).toBeUndefined()
  })

  it('refuses paused preference and profile activation writes after switching accounts', async () => {
    const { result } = renderHook(() => ({ save: useSaveTranslationConfig(), activate: useActivateAiProfile() }), { wrapper })
    onlineManager.setOnline(false)
    let save!: Promise<unknown>
    let activate!: Promise<unknown>
    act(() => { save = result.current.save.mutateAsync(input); activate = result.current.activate.mutateAsync('same-profile') })
    const rejected = [expect(save).rejects.toHaveProperty('name', 'AbortError'), expect(activate).rejects.toHaveProperty('name', 'AbortError')]
    await waitFor(() => expect(result.current.save.isPaused && result.current.activate.isPaused).toBe(true))
    act(() => useAuthStore.getState().setAuth(account('next')))
    await act(async () => { onlineManager.setOnline(true); await client.resumePausedMutations() })
    await Promise.all(rejected)
    expect(fetch).not.toHaveBeenCalled()
    expect(client.getQueryData(aiConfigKey('next'))).toBeUndefined()
    expect(client.getQueryData(translationConfigKey('next'))).toBeUndefined()
  })
})
