import { afterEach, describe, expect, it, vi } from 'vitest'

import { TtsAudioBufferPlayer } from '../tts-audio-buffer'

class FakeSource {
  buffer: AudioBuffer | null = null
  playbackRate = { value: 1 }
  onended: (() => void) | null = null
  readonly start = vi.fn((_when?: number) => undefined)
  readonly stop = vi.fn(() => undefined)
  readonly connect = vi.fn(() => undefined)
  readonly disconnect = vi.fn(() => undefined)
}

class FakeAudioContext {
  state: AudioContextState = 'running'
  currentTime = 10
  destination = {}
  readonly sources: FakeSource[] = []
  readonly resume = vi.fn(async () => undefined)
  readonly suspend = vi.fn(async () => undefined)
  readonly createBufferSource = vi.fn(() => {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  })
  readonly decodeAudioData = vi.fn(async () => ({}) as AudioBuffer)
}

function audio(duration: number) {
  return { buffer: { duration } as AudioBuffer }
}

function events() {
  return { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
}

let sharedTestContext: FakeAudioContext | null = null

describe('TtsAudioBufferPlayer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('schedules consecutive prepared buffers without waiting for the first to end', async () => {
    const context = new FakeAudioContext()
    sharedTestContext = context
    vi.stubGlobal('AudioContext', class { constructor() { return context } })
    const player = new TtsAudioBufferPlayer()
    const first = events()
    const second = events()
    const firstPlayback = player.schedule(audio(1), 1, new AbortController().signal, first)
    const secondPlayback = player.schedule(audio(2), 1, new AbortController().signal, second)

    await vi.waitFor(() => expect(context.sources).toHaveLength(2))
    expect(context.sources[0]?.start).toHaveBeenCalledWith(10.03)
    expect(context.sources[1]?.start).toHaveBeenCalledWith(11.03)
    expect(first.onStart).toHaveBeenCalledTimes(1)
    expect(second.onStart).not.toHaveBeenCalled()

    context.sources[0]!.onended?.()
    expect(first.onEnd).toHaveBeenCalledTimes(1)
    expect(second.onStart).toHaveBeenCalledTimes(1)
    context.sources[1]!.onended?.()
    await Promise.all([firstPlayback, secondPlayback])
    expect(second.onEnd).toHaveBeenCalledTimes(1)
  })

  it('keeps the next sentence highlight aligned with a scheduled sentence gap', async () => {
    const context = sharedTestContext ?? new FakeAudioContext()
    context.sources.length = 0
    vi.stubGlobal('AudioContext', class { constructor() { return context } })
    const player = new TtsAudioBufferPlayer()
    const first = events()
    const second = events()
    const firstPlayback = player.schedule(audio(1), 1, new AbortController().signal, first, 0.15)
    const secondPlayback = player.schedule(audio(2), 1, new AbortController().signal, second, 0.15)

    await vi.waitFor(() => expect(context.sources).toHaveLength(2))
    expect(context.sources[1]?.start).toHaveBeenCalledWith(11.18)
    expect(second.onStart).not.toHaveBeenCalled()

    vi.useFakeTimers()
    context.currentTime = 11.03
    context.sources[0]!.onended?.()
    expect(first.onEnd).toHaveBeenCalledTimes(1)
    expect(second.onStart).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(second.onStart).toHaveBeenCalledTimes(1)

    context.sources[1]!.onended?.()
    await Promise.all([firstPlayback, secondPlayback])
    vi.useRealTimers()
    expect(second.onEnd).toHaveBeenCalledTimes(1)
  })
})
