export interface DecodedTtsAudio {
  buffer: AudioBuffer
}

interface AudioContextConstructor {
  new (): AudioContext
}

function abortedError() {
  return new DOMException('Speech request was aborted', 'AbortError')
}

function getAudioContextConstructor() {
  const globals = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextConstructor }
  return globals.AudioContext ?? globals.webkitAudioContext
}

interface ScheduledPlayback {
  source: AudioBufferSourceNode
  events: { onStart: () => void; onEnd: () => void; onError: (error: Error) => void }
  startTime: number
  startTimer: ReturnType<typeof setTimeout> | null
  gapSec: number
  started: boolean
  settled: boolean
  resolve: () => void
  reject: (error: Error) => void
  abort: () => void
}

const SCHEDULE_SAFETY_SEC = 0.03
let sharedContext: AudioContext | null = null

function getSharedAudioContext() {
  if (sharedContext) return sharedContext
  const Context = getAudioContextConstructor()
  if (!Context) throw new Error('Buffered audio is unavailable in this browser')
  sharedContext = new Context()
  return sharedContext
}

export class TtsAudioBufferPlayer {
  private context: AudioContext | null = null
  private scheduled: ScheduledPlayback[] = []
  private nextStartTime = 0

  private getContext() {
    if (this.context) return this.context
    this.context = getSharedAudioContext()
    void this.context.resume().catch(() => undefined)
    return this.context
  }

  async decode(data: ArrayBuffer): Promise<DecodedTtsAudio> {
    const context = this.getContext()
    const buffer = await context.decodeAudioData(data.slice(0))
    return { buffer }
  }

  async unlock() {
    try {
      await this.getContext().resume()
    } catch {
      // Playback reports a user-visible error if the browser still blocks it.
    }
  }

  async play(audio: DecodedTtsAudio, rate: number, signal: AbortSignal, events: { onStart: () => void; onEnd: () => void; onError: (error: Error) => void }, gapSec = 0) {
    await this.stop()
    return this.schedule(audio, rate, signal, events, gapSec)
  }

  async schedule(audio: DecodedTtsAudio, rate: number, signal: AbortSignal, events: { onStart: () => void; onEnd: () => void; onError: (error: Error) => void }, gapSec = 0) {
    if (signal.aborted) throw abortedError()
    const context = this.getContext()
    try {
      await context.resume()
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      events.onError(failure)
      throw failure
    }
    if (signal.aborted) throw abortedError()

    const source = context.createBufferSource()
    source.buffer = audio.buffer
    source.playbackRate.value = rate
    source.connect(context.destination)
    const start = Math.max(
      this.nextStartTime,
      context.currentTime + (this.scheduled.length ? 0 : SCHEDULE_SAFETY_SEC),
    )
    this.nextStartTime = start + audio.buffer.duration / Math.max(rate, 0.01) + Math.max(gapSec, 0)

    return new Promise<void>((resolve, reject) => {
      const playback: ScheduledPlayback = {
        source,
        events,
        startTime: start,
        startTimer: null,
        gapSec: Math.max(gapSec, 0),
        started: this.scheduled.length === 0,
        settled: false,
        resolve,
        reject,
        abort: () => {
          settle(abortedError())
          try { source.stop() } catch { /* source may already be ended */ }
        },
      }
      const cleanup = () => {
        signal.removeEventListener('abort', abort)
        if (playback.startTimer !== null) {
          clearTimeout(playback.startTimer)
          playback.startTimer = null
        }
        source.onended = null
        const index = this.scheduled.indexOf(playback)
        if (index >= 0) this.scheduled.splice(index, 1)
      }
      const settle = (error?: Error) => {
        if (playback.settled) return
        playback.settled = true
        cleanup()
        if (error) playback.reject(error)
        else {
          events.onEnd()
          playback.resolve()
        }
      }
      const abort = () => {
        try { source.stop() } catch { /* source may already be ended */ }
        settle(abortedError())
      }
      const finish = () => {
        if (playback.settled) return
        const index = this.scheduled.indexOf(playback)
        const next = index >= 0 ? this.scheduled[index + 1] : undefined
        settle()
        if (next && !next.started && !next.settled) {
          const delayMs = next.gapSec > 0 ? Math.max(0, (next.startTime - context.currentTime) * 1000) : 0
          if (delayMs === 0) {
            next.started = true
            next.events.onStart()
          } else {
            next.startTimer = setTimeout(() => {
              next.startTimer = null
              if (next.settled || next.started) return
              next.started = true
              next.events.onStart()
            }, delayMs)
          }
        }
      }
      source.onended = finish
      signal.addEventListener('abort', abort, { once: true })
      this.scheduled.push(playback)
      try {
        source.start(start)
        if (playback.started) events.onStart()
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        events.onError(failure)
        settle(failure)
      }
    })
  }

  setRate(rate: number) {
    for (const playback of this.scheduled) {
      if (!playback.settled) playback.source.playbackRate.value = rate
    }
  }

  async pause() {
    if (!this.scheduled.length || !this.context) return false
    if (this.context.state === 'running') {
      try {
        await this.context.suspend()
      } catch {
        return false
      }
    }
    return true
  }

  async resume() {
    if (!this.scheduled.length || !this.context) return false
    if (this.context.state !== 'running') {
      try {
        await this.context.resume()
      } catch {
        return false
      }
    }
    return true
  }

  async stop() {
    const scheduled = this.scheduled.slice()
    this.nextStartTime = 0
    for (const playback of scheduled) {
      playback.abort()
      try { playback.source.disconnect() } catch { /* source may already be disconnected */ }
    }
  }
}
