import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DictionaryDefinition from '@/features/reader/components/DictionaryDefinition'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

let client: QueryClient
let audio: HTMLAudioElement[]
beforeEach(() => {
  useAuthStore.getState().setAuth({ id: 'reader', username: 'Reader', role: 'member' })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  audio = []
  vi.stubGlobal('Audio', vi.fn(function (source: string) {
    const element = document.createElement('audio')
    element.src = source
    vi.spyOn(element, 'play').mockResolvedValue()
    vi.spyOn(element, 'pause').mockImplementation(() => {})
    vi.spyOn(element, 'load').mockImplementation(() => {})
    audio.push(element)
    return element
  }))
})
afterEach(() => { cleanup(); client.clear(); useAuthStore.getState().clearAuth(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('dictionary resource media lifetime', () => {
  it.each(['unmount', 'account'] as const)('stops sound playback and drops its source on %s', async (action) => {
    const view = render(<QueryClientProvider client={client}><DictionaryDefinition accountId="reader" id="dict" html="<p>Definition</p>" onNavigate={vi.fn()} /></QueryClientProvider>)
    const iframe = await screen.findByTitle('dictionary.title') as HTMLIFrameElement
    const frame = iframe.contentDocument!
    frame.body.innerHTML = '<a data-sound-src="/api/v1/dictionaries/dict/resource?key=sound.wav" href="#">Sound</a>'
    fireEvent.click(frame.querySelector('a')!)
    expect(audio).toHaveLength(1)
    expect(audio[0]!.play).toHaveBeenCalledOnce()
    if (action === 'unmount') view.unmount()
    else act(() => useAuthStore.getState().setAuth({ id: 'next', username: 'Next', role: 'member' }))
    expect(audio[0]!.pause).toHaveBeenCalledOnce()
    expect(audio[0]!.load).toHaveBeenCalledOnce()
    expect(audio[0]!.getAttribute('src')).toBeNull()
    expect(screen.queryByTitle('dictionary.title')).not.toBeInTheDocument()
  })
})
