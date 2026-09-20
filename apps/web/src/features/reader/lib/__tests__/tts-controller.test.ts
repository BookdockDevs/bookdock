import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookReader, TtsSegment } from '../../types'
import { TtsController } from '../tts-controller'
import { SystemSpeechClient } from '../tts-client'
import type { TtsClient, TtsPlaybackEvents, TtsPreparedAudio, TtsSpeakOptions, TtsVoice } from '../tts-client'

class FakeUtterance {
  text: string
  rate = 1
  voice: SpeechSynthesisVoice | null = null
  onstart: (() => void) | null = null
  onboundary: ((event: SpeechSynthesisEvent) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

function fakeRenderer(segments: TtsSegment[]) {
  const listeners = new Map<string, () => void>()
  let index = 0
  return {
    renderer: {
      getTtsSegment: vi.fn(async () => segments[index]),
      peekTtsSegments: vi.fn(async () => segments.slice(index + 1, index + 5)),
      nextTtsSegment: vi.fn(async () => segments[++index]),
      previousTtsSegment: vi.fn(async () => segments[Math.max(0, --index)]),
      revealTtsSegment: vi.fn(async () => undefined),
      highlightTtsSegment: vi.fn(async () => undefined),
      clearTtsHighlight: vi.fn(),
      on: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener)
        return () => listeners.delete(type)
      }),
    } as unknown as BookReader,
    emit(type: string) {
      listeners.get(type)?.()
    },
  }
}

class FakeBufferedClient implements TtsClient {
  readonly id = 'service' as const
  readonly pauseResume = true
  readonly pending = new Map<string, { events: TtsPlaybackEvents; resolve: () => void }>()
  readonly prepare = vi.fn(async (_segment: TtsSegment, _options: TtsSpeakOptions, signal: AbortSignal) => {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    return { buffer: {} as AudioBuffer } as TtsPreparedAudio
  })
  readonly playPrepared = vi.fn((segment: TtsSegment, _audio: TtsPreparedAudio, _options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents) => new Promise<void>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      this.pending.delete(segment.id)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    this.pending.set(segment.id, { events, resolve: () => { signal.removeEventListener('abort', abort); resolve() } })
  }))
  readonly pause = vi.fn(async () => true)
  readonly resume = vi.fn(async () => true)
  readonly stop = vi.fn(async () => undefined)
  readonly speak = vi.fn(async () => undefined)

  listVoices(): TtsVoice[] {
    return []
  }

  finish(id: string) {
    const current = this.pending.get(id)
    if (!current) throw new Error(`No pending audio for ${id}`)
    this.pending.delete(id)
    current.events.onStart()
    current.events.onEnd()
    current.resolve()
  }
}

class FakeScheduledClient extends FakeBufferedClient {
  readonly schedulePrepared = vi.fn((segment: TtsSegment, audio: TtsPreparedAudio, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents) => this.playPrepared(segment, audio, options, signal, events))
}

describe('TtsController', () => {
  let speech: { current: FakeUtterance | null; speaking: boolean; pending: boolean; paused: boolean; speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn>; getVoices: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    speech = {
      current: null,
      speaking: false,
      pending: false,
      paused: false,
      speak: vi.fn((utterance: FakeUtterance) => { speech.current = utterance }),
      cancel: vi.fn(),
      pause: vi.fn(() => { speech.paused = true }),
      resume: vi.fn(() => { speech.paused = false }),
      getVoices: vi.fn(() => []),
    }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('speechSynthesis', speech)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats unavailable system speech voices as an empty list', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    expect(new SystemSpeechClient().listVoices()).toEqual([])
  })

  it('highlights a segment only when the speech client starts it', async () => {
    const segment = { id: 's1', text: '第一句', cfi: 'epubcfi(/6/2)', chapterIndex: 0 }
    const fake = fakeRenderer([segment])
    const controller = new TtsController(fake.renderer, { engine: 'system', voiceId: '', rate: 1, autoNext: false, highlight: true })
    const start = controller.start()
    await Promise.resolve()
    await Promise.resolve()

    expect(controller.getSnapshot()).toMatchObject({ status: 'starting', segment })
    expect(speech.cancel).not.toHaveBeenCalled()
    speech.current?.onstart?.()
    await Promise.resolve()
    expect(controller.getSnapshot()).toMatchObject({ status: 'playing', segment })
    expect(fake.renderer.highlightTtsSegment).toHaveBeenCalledWith(segment)

    speech.current?.onend?.()
    await start
    expect(controller.getSnapshot()).toMatchObject({ status: 'idle', segment: null })
    controller.dispose()
  })

  it('keeps sentence highlighting enabled after user navigation', () => {
    const fake = fakeRenderer([{ id: 's1', text: '第一句', cfi: 'epubcfi(/6/2)', chapterIndex: 0 }])
    const controller = new TtsController(fake.renderer, { engine: 'system', voiceId: '', rate: 1, autoNext: false, highlight: true })
    fake.emit('userJump')
    expect(controller.getSnapshot().highlighting).toBe(true)
    controller.setHighlighting(false)
    expect(controller.getSnapshot().highlighting).toBe(false)
    controller.dispose()
  })

  it('ignores a late speech start after stop cancels the generation', async () => {
    const segment = { id: 's1', text: '第一句', cfi: 'epubcfi(/6/2)', chapterIndex: 0 }
    const fake = fakeRenderer([segment])
    const controller = new TtsController(fake.renderer, { engine: 'system', voiceId: '', rate: 1, autoNext: false, highlight: true })
    const start = controller.start()
    await Promise.resolve()
    await Promise.resolve()
    const lateStart = speech.current?.onstart
    await controller.stop()
    lateStart?.()
    await start
    expect(controller.getSnapshot()).toMatchObject({ status: 'idle', segment: null })
    expect(fake.renderer.highlightTtsSegment).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('pauses only an active system utterance and resumes the same utterance', async () => {
    const segment = { id: 's1', text: '第一句', cfi: 'epubcfi(/6/2)', chapterIndex: 0 }
    const fake = fakeRenderer([segment])
    const controller = new TtsController(fake.renderer, { engine: 'system', voiceId: '', rate: 1, autoNext: false, highlight: true })
    const start = controller.start()
    await Promise.resolve()
    await Promise.resolve()
    speech.current?.onstart?.()
    speech.speaking = true

    await controller.pause()
    expect(speech.pause).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().status).toBe('paused')

    await controller.resume()
    expect(speech.resume).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().status).toBe('playing')

    await controller.stop()
    await start
    controller.dispose()
  })

  it('coalesces rapid rate changes into one active restart', async () => {
    const segment = { id: 's1', text: '第一句', cfi: 'epubcfi(/6/2)', chapterIndex: 0 }
    const fake = fakeRenderer([segment])
    const controller = new TtsController(fake.renderer, { engine: 'system', voiceId: '', rate: 1, autoNext: false, highlight: false })
    const start = controller.start()
    await Promise.resolve()
    await Promise.resolve()
    speech.current?.onstart?.()
    speech.speaking = true

    controller.setPreferences({ engine: 'system', voiceId: '', rate: 1.2, autoNext: false, highlight: false })
    controller.setPreferences({ engine: 'system', voiceId: '', rate: 1.4, autoNext: false, highlight: false })
    await vi.waitFor(() => expect(speech.current?.rate).toBe(1.4))
    expect(controller.getSnapshot().status).toBe('starting')
    speech.current?.onstart?.()
    speech.current?.onend?.()
    await start
    controller.dispose()
  })

  it('leaves a natural gap before starting the next system sentence', async () => {
    vi.useFakeTimers()
    try {
      const segments = [
        { id: 's1', text: '第一句', cfi: 'epubcfi(/6/2)', chapterIndex: 0 },
        { id: 's2', text: '第二句', cfi: 'epubcfi(/6/4)', chapterIndex: 0 },
      ]
      const fake = fakeRenderer(segments)
      const controller = new TtsController(fake.renderer, { engine: 'system', voiceId: '', rate: 1, autoNext: true, highlight: false })
      const start = controller.start()
      await Promise.resolve()
      await Promise.resolve()
      expect(speech.speak).toHaveBeenCalledTimes(1)

      speech.current?.onstart?.()
      speech.current?.onend?.()
      await vi.advanceTimersByTimeAsync(149)
      expect(speech.speak).toHaveBeenCalledTimes(1)
      expect(controller.getSnapshot().status).toBe('playing')
      await vi.advanceTimersByTimeAsync(1)
      await vi.waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(2))
      expect(controller.getSnapshot().status).toBe('playing')

      await controller.stop()
      await start
      controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('prefetches online audio but always plays the visible segments in order', async () => {
    const segments = [
      { id: 's1', text: '第一句', cfi: 'epubcfi(/6/2)', chapterIndex: 0 },
      { id: 's2', text: '第二句', cfi: 'epubcfi(/6/4)', chapterIndex: 0 },
      { id: 's3', text: '第三句', cfi: 'epubcfi(/6/6)', chapterIndex: 0 },
    ]
    const fake = fakeRenderer(segments)
    const client = new FakeBufferedClient()
    const controller = new TtsController(fake.renderer, { engine: 'service', voiceId: '', rate: 1, autoNext: true, highlight: false }, client)
    const start = controller.start()

    await vi.waitFor(() => expect(client.prepare).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(client.playPrepared).toHaveBeenCalledTimes(1))
    expect(client.playPrepared.mock.calls[0]?.[0]).toBe(segments[0])

    client.finish('s1')
    await vi.waitFor(() => expect(client.playPrepared).toHaveBeenCalledTimes(2))
    expect(client.playPrepared.mock.calls[1]?.[0]).toBe(segments[1])

    client.finish('s2')
    await vi.waitFor(() => expect(client.playPrepared).toHaveBeenCalledTimes(3))
    expect(client.playPrepared.mock.calls[2]?.[0]).toBe(segments[2])
    client.finish('s3')
    await start

    expect(fake.renderer.nextTtsSegment).toHaveBeenCalledTimes(3)
    expect(controller.getSnapshot()).toMatchObject({ status: 'idle', segment: null })
    controller.dispose()
  })

  it('retries a transient preparation failure before falling back', async () => {
    const segment = { id: 's1', text: '第一句', cfi: 'epubcfi(/6/2)', chapterIndex: 0 }
    const fake = fakeRenderer([segment])
    const client = new FakeBufferedClient()
    client.prepare.mockRejectedValueOnce(new Error('temporary network failure'))
    client.prepare.mockRejectedValueOnce(new Error('temporary network failure'))
    const controller = new TtsController(fake.renderer, { engine: 'service', voiceId: '', rate: 1, autoNext: false, highlight: false }, client)
    const start = controller.start()

    await vi.waitFor(() => expect(client.prepare).toHaveBeenCalledTimes(3), { timeout: 2_000 })
    await vi.waitFor(() => expect(client.playPrepared).toHaveBeenCalledTimes(1))
    client.finish('s1')
    await start
    expect(controller.getSnapshot()).toMatchObject({ status: 'idle', segment: null })
    controller.dispose()
  })

  it('schedules the next prepared sentence before the current one ends', async () => {
    const segments = [
      { id: 's1', text: '第一句', cfi: 'epubcfi(/6/2)', chapterIndex: 0 },
      { id: 's2', text: '第二句', cfi: 'epubcfi(/6/4)', chapterIndex: 0 },
      { id: 's3', text: '第三句', cfi: 'epubcfi(/6/6)', chapterIndex: 0 },
    ]
    const fake = fakeRenderer(segments)
    const client = new FakeScheduledClient()
    const controller = new TtsController(fake.renderer, { engine: 'service', voiceId: '', rate: 1, autoNext: true, highlight: false }, client)
    const start = controller.start()

    await vi.waitFor(() => expect(client.schedulePrepared).toHaveBeenCalledTimes(2))
    expect(client.schedulePrepared.mock.calls[0]?.[0]).toBe(segments[0])
    expect(client.schedulePrepared.mock.calls[1]?.[0]).toBe(segments[1])

    client.finish('s1')
    await vi.waitFor(() => expect(client.schedulePrepared).toHaveBeenCalledTimes(3))
    expect(client.schedulePrepared.mock.calls[2]?.[0]).toBe(segments[2])
    client.finish('s2')
    client.finish('s3')
    await start
    expect(controller.getSnapshot()).toMatchObject({ status: 'idle', segment: null })
    controller.dispose()
  })

  it('does not schedule a following sentence when auto-next is disabled', async () => {
    const segments = [
      { id: 's1', text: '第一句', cfi: 'epubcfi(/6/2)', chapterIndex: 0 },
      { id: 's2', text: '第二句', cfi: 'epubcfi(/6/4)', chapterIndex: 0 },
    ]
    const fake = fakeRenderer(segments)
    const client = new FakeScheduledClient()
    const controller = new TtsController(fake.renderer, { engine: 'service', voiceId: '', rate: 1, autoNext: false, highlight: false }, client)
    const start = controller.start()

    await vi.waitFor(() => expect(client.schedulePrepared).toHaveBeenCalledTimes(1))
    expect(client.schedulePrepared.mock.calls[0]?.[0]).toBe(segments[0])
    client.finish('s1')
    await start
    expect(client.schedulePrepared).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot()).toMatchObject({ status: 'idle', segment: null })
    controller.dispose()
  })
})
