import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TtsServiceRes } from '@bookdock/shared'

import { ttsServicesKey, useDeleteTtsService, useTtsServices, useTtsServiceVoices } from '@/api/hooks/useTts'
import { TtsAudioBufferPlayer } from '@/features/reader/lib/tts-audio-buffer'
import { EdgeSpeechClient, ServiceAudioClient } from '@/features/reader/lib/tts-client'
import { useAuthStore } from '@/stores/auth.store'

const account = (id: string) => ({ id, username: id, role: 'member' })
const service: TtsServiceRes = { id: 'same-service', name: 'Voice', provider: 'openai', baseUrl: null, model: 'voice-model', defaultVoice: 'alloy', options: {}, credentialsConfigured: true, createdAt: 1, updatedAt: 1 }
const segment = { id: 'private-local-segment', text: 'Explicit read-aloud sentence', cfi: 'epubcfi(/6/2)', chapterIndex: 0 }
const options = { voiceId: '', rate: 1 }
let client: QueryClient
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider> }
beforeEach(() => {
  onlineManager.setOnline(true)
  useAuthStore.getState().setAuth(account('first'))
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [service] }))))
})
afterEach(() => { cleanup(); client.clear(); onlineManager.setOnline(true); useAuthStore.getState().clearAuth(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('speech service account ownership', () => {
  it('prevents anonymous list and voice refetches from using stale service IDs', async () => {
    useAuthStore.getState().clearAuth()
    const { result } = renderHook(() => ({ list: useTtsServices(), voices: useTtsServiceVoices(service.id) }), { wrapper })
    await act(async () => { await result.current.list.refetch(); await result.current.voices.refetch() })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('isolates account responses even when a previous transport ignores cancellation', async () => {
    const settle: ((response: Response) => void)[] = []
    vi.mocked(fetch).mockImplementation(async () => await new Promise<Response>((resolve) => { settle.push(resolve) }))
    const { result } = renderHook(() => useTtsServices(), { wrapper })
    await waitFor(() => expect(settle).toHaveLength(1))
    act(() => useAuthStore.getState().setAuth(account('next')))
    await waitFor(() => expect(settle).toHaveLength(2))
    await act(async () => {
      settle[1]!(new Response(JSON.stringify({ data: [{ ...service, name: 'Next voice' }] })))
      settle[0]!(new Response(JSON.stringify({ data: [{ ...service, name: 'Old private voice' }] })))
    })
    await waitFor(() => expect(result.current.data?.data[0]?.name).toBe('Next voice'))
    expect(client.getQueryData(ttsServicesKey('first'))).toBeUndefined()
    expect(client.getQueryData(ttsServicesKey('next'))).toEqual({ data: [{ ...service, name: 'Next voice' }] })
  })

  it('rejects a paused management command instead of deleting under the next account', async () => {
    const { result } = renderHook(() => useDeleteTtsService(), { wrapper })
    onlineManager.setOnline(false)
    let pending!: Promise<unknown>
    act(() => { pending = result.current.mutateAsync(service.id) })
    const rejected = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    await waitFor(() => expect(result.current.isPaused).toBe(true))
    act(() => useAuthStore.getState().setAuth(account('next')))
    await act(async () => { onlineManager.setOnline(true); await client.resumePausedMutations() })
    await rejected
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('local sentence speech transport', () => {
  it.each(['edge', 'service'] as const)('sends only text and voice options through the %s gateway', async (engine) => {
    const audio = { buffer: {} as AudioBuffer }
    const decode = vi.spyOn(TtsAudioBufferPlayer.prototype, 'decode').mockResolvedValue(audio)
    vi.mocked(fetch).mockImplementation(async () => engine === 'edge' ? new Response(JSON.stringify({ data: { audioBase64: 'YQ==', boundaries: [] } })) : new Response(new Uint8Array([1])))
    const speech = engine === 'edge' ? new EdgeSpeechClient() : new ServiceAudioClient(service)
    expect(await speech.prepare(segment, options, new AbortController().signal)).toBe(audio)
    const [url, request] = vi.mocked(fetch).mock.calls[0]!
    const body = JSON.parse(request!.body as string)
    expect(url).toBe(engine === 'edge' ? '/api/v1/tts/edge/speech' : '/api/v1/tts/speech')
    expect(body).toEqual(engine === 'edge' ? { text: segment.text, voice: 'zh-CN-XiaoxiaoNeural', rate: 1 } : { text: segment.text, voice: 'alloy', rate: 1, serviceId: service.id })
    expect(decode).toHaveBeenCalledOnce()
  })

  it.each(['edge', 'service'] as const)('refuses anonymous %s synthesis without a network request', async (engine) => {
    useAuthStore.getState().clearAuth()
    const speech = engine === 'edge' ? new EdgeSpeechClient() : new ServiceAudioClient(service)
    await expect(speech.prepare(segment, options, new AbortController().signal)).rejects.toHaveProperty('name', 'AbortError')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['edge', 'service'] as const)('cancels old %s acquisition and refuses replay under the next account', async (engine) => {
    const decode = vi.spyOn(TtsAudioBufferPlayer.prototype, 'decode')
    let settle!: (response: Response) => void
    let signal!: AbortSignal
    vi.mocked(fetch).mockImplementation(async (_url, request) => { signal = request!.signal!; return await new Promise<Response>((resolve) => { settle = resolve }) })
    const speech = engine === 'edge' ? new EdgeSpeechClient() : new ServiceAudioClient(service)
    const pending = speech.prepare(segment, options, new AbortController().signal)
    const rejected = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    useAuthStore.getState().setAuth(account('next'))
    expect(signal.aborted).toBe(true)
    settle(engine === 'edge' ? new Response(JSON.stringify({ data: { audioBase64: 'YQ==', boundaries: [] } })) : new Response(new Uint8Array([1])))
    await rejected
    expect(decode).not.toHaveBeenCalled()
    await expect(speech.prepare(segment, options, new AbortController().signal)).rejects.toHaveProperty('name', 'AbortError')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not let a late speech 401 disconnect the new account', async () => {
    let settle!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(async () => await new Promise<Response>((resolve) => { settle = resolve }))
    const pending = new ServiceAudioClient(service).prepare(segment, options, new AbortController().signal)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    useAuthStore.getState().setAuth(account('next'))
    settle(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'expired' } }), { status: 401 }))
    await rejected
    expect(useAuthStore.getState().user?.id).toBe('next')
  })
})
