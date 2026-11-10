import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TtsPanel from '@/features/reader/components/TtsPanel'
import { TtsSessionProvider } from '@/features/reader/hooks/TtsSessionProvider'
import { RendererContext } from '@/features/reader/hooks/useReaderApi'
import { useTtsSession } from '@/features/reader/hooks/useTtsSession'
import type { TtsSessionContextValue } from '@/features/reader/hooks/tts-session-context'
import { ReaderPlaybackCoordinator } from '@/features/reader/lib/playback-coordinator'
import type { BookReader } from '@/features/reader/types'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a href="/settings">{children}</a> }))

let session: TtsSessionContextValue
let client: QueryClient
const segment = { id: 'local-sentence', text: 'Local read-aloud text', cfi: 'epubcfi(/6/2)', chapterIndex: 0 }
function renderer(): BookReader {
  return { on: vi.fn(() => vi.fn()), getTtsSegment: vi.fn(async () => segment), clearTtsHighlight: vi.fn() } as unknown as BookReader
}
function Probe() { session = useTtsSession(); return <TtsPanel /> }
function mount(book = renderer()) {
  const coordinator = new ReaderPlaybackCoordinator()
  const tree = (source: BookReader) => <QueryClientProvider client={client}><RendererContext.Provider value={{ renderer: source }}><TtsSessionProvider renderer={source} coordinator={coordinator}><Probe /></TtsSessionProvider></RendererContext.Provider></QueryClientProvider>
  const view = render(tree(book))
  return { ...view, changeSource: (source: BookReader) => view.rerender(tree(source)) }
}
beforeEach(() => {
  useAuthStore.getState().clearAuth()
  useUiStore.setState({ ttsEngine: 'system', ttsServiceId: null, ttsVoiceId: '', ttsRate: 1, ttsAutoNext: false, ttsFollow: false })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }))))
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  vi.stubGlobal('speechSynthesis', { getVoices: vi.fn(() => []), speak: vi.fn(), cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => { cleanup(); client.clear(); useAuthStore.getState().clearAuth(); vi.unstubAllGlobals() })

describe('source-independent speech session and panel', () => {
  it('plays local-renderer text through system speech without an account or HTTP request', async () => {
    mount()
    expect(screen.getByText('reader.ttsPlay')).toBeEnabled()
    fireEvent.click(screen.getByText('reader.ttsPlay'))
    await waitFor(() => expect(speechSynthesis.speak).toHaveBeenCalledOnce())
    expect(vi.mocked(speechSynthesis.speak).mock.calls[0]![0].text).toBe(segment.text)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('explains anonymous gateway requirements and permits an explicit switch to system speech', async () => {
    useUiStore.setState({ ttsEngine: 'edge' })
    mount()
    expect(screen.getByText('reader.ttsUnavailable.account')).toBeInTheDocument()
    expect(screen.getByText('reader.ttsPlay')).toBeDisabled()
    fireEvent.click(screen.getByTitle('Edge TTS'))
    fireEvent.click(screen.getByRole('option', { name: 'reader.ttsSystem' }))
    await waitFor(() => expect(screen.getByText('reader.ttsPlay')).toBeEnabled())
    expect(session.state.engine).toBe('system')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves an unavailable selected service rather than silently switching engines', async () => {
    useAuthStore.getState().setAuth({ id: 'reader', username: 'reader', role: 'member' })
    useUiStore.setState({ ttsEngine: 'service', ttsServiceId: 'missing-service' })
    mount()
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(session.state.engine).toBe('service')
    expect(screen.getByText('reader.ttsPlay')).toBeDisabled()
    expect(screen.getAllByText('reader.ttsUnavailable.service').length).toBeGreaterThan(0)
    expect(speechSynthesis.speak).not.toHaveBeenCalled()
  })

  it('keeps system speech usable when the optional service list fails and permits retry', async () => {
    useAuthStore.getState().setAuth({ id: 'reader', username: 'reader', role: 'member' })
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Service offline'))
    mount()
    expect(await screen.findByText('errors.loadFailed')).toBeInTheDocument()
    expect(screen.getByText('reader.ttsPlay')).toBeEnabled()
    fireEvent.click(screen.getByText('errors.retry'))
    await waitFor(() => expect(screen.queryByText('errors.loadFailed')).not.toBeInTheDocument())
    expect(session.state.engine).toBe('system')
  })

  it('stops old playback and replaces the controller across account and source changes without auto-starting', async () => {
    const view = mount()
    fireEvent.click(screen.getByText('reader.ttsPlay'))
    await waitFor(() => expect(speechSynthesis.speak).toHaveBeenCalledOnce())
    const first = session.controller
    act(() => useAuthStore.getState().setAuth({ id: 'reader', username: 'reader', role: 'member' }))
    await waitFor(() => expect(session.controller).not.toBe(first))
    expect(speechSynthesis.cancel).toHaveBeenCalled()
    const next = session.controller
    view.changeSource(renderer())
    await waitFor(() => expect(session.controller).not.toBe(next))
    expect(session.state.status).toBe('idle')
    expect(speechSynthesis.speak).toHaveBeenCalledOnce()
  })
})
