import type { BookReader, TtsSegment } from '../types'
import type { TtsClient, TtsPlaybackEvents, TtsSpeakOptions, TtsVoice } from './tts-client'

function abortedError() {
  return new DOMException('Media Overlay playback was aborted', 'AbortError')
}

export class MediaOverlayClient implements TtsClient {
  readonly id = 'media-overlay' as const
  readonly pauseResume = true
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private audioHref: string | null = null
  private cancelActive: (() => void) | null = null
  private handoffTimer: ReturnType<typeof setTimeout> | null = null
  private rate = 1

  constructor(private readonly renderer: BookReader) {}

  listVoices(): TtsVoice[] {
    return [{ id: 'narration', name: 'Narration', lang: '' }]
  }

  canContinueTo(segment: TtsSegment): boolean {
    const href = segment.mediaOverlay?.cue.audioHref
    return Boolean(href && this.audio && this.audioHref === href)
  }

  private cancelHandoff() {
    if (this.handoffTimer === null) return
    clearTimeout(this.handoffTimer)
    this.handoffTimer = null
  }

  private releaseAudio() {
    this.cancelHandoff()
    this.audio?.pause()
    this.audio = null
    this.audioHref = null
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
  }

  private scheduleHandoff() {
    this.cancelHandoff()
    this.handoffTimer = setTimeout(() => {
      this.handoffTimer = null
      this.releaseAudio()
    }, 2000)
  }

  async speak(segment: TtsSegment, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents): Promise<void> {
    const metadata = segment.mediaOverlay
    if (!metadata) throw new Error('Media Overlay metadata is missing')
    this.cancelHandoff()
    if (signal.aborted) throw abortedError()
    const href = metadata.cue.audioHref
    let audio = this.audio
    if (!audio || this.audioHref !== href) {
      await this.stop()
      const blob = await this.renderer.getMediaOverlayAudio(segment)
      if (!blob) throw new Error(`Media Overlay audio is unavailable: ${href}`)
      if (signal.aborted) throw abortedError()
      const url = URL.createObjectURL(blob)
      audio = new Audio(url)
      audio.preload = 'auto'
      this.audio = audio
      this.audioHref = href
      this.objectUrl = url
    } else {
      audio.pause()
    }
    const begin = metadata.cue.clipBegin ?? 0
    const end = metadata.cue.clipEnd
    this.audio = audio
    this.rate = options.rate
    audio.playbackRate = options.rate

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let started = false
      const cleanup = () => {
        signal.removeEventListener('abort', abort)
        audio.removeEventListener('loadedmetadata', start)
        audio.removeEventListener('playing', onPlaying)
        audio.removeEventListener('timeupdate', onTimeUpdate)
        audio.removeEventListener('ended', finish)
        audio.removeEventListener('error', onError)
        if (this.cancelActive === cancel) this.cancelActive = null
      }
      const finish = () => {
        if (settled) return
        settled = true
        cleanup()
        audio.pause()
        this.scheduleHandoff()
        events.onEnd()
        resolve()
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        audio.pause()
        if (this.audio === audio) this.releaseAudio()
        events.onError(error)
        reject(error)
      }
      const cancel = () => {
        if (settled) return
        settled = true
        cleanup()
        audio.pause()
        reject(abortedError())
      }
      const abort = () => cancel()
      const onPlaying = () => {
        if (started) return
        started = true
        events.onStart()
      }
      const onTimeUpdate = () => {
        if (end !== null && audio.currentTime >= end) finish()
      }
      const onError = () => fail(new Error(`Failed to play Media Overlay audio: ${metadata.cue.audioHref}`))
      const start = () => {
        if (settled) return
        audio.currentTime = begin
        audio.play().catch((error: unknown) => fail(error instanceof Error ? error : new Error('Media Overlay playback failed')))
      }
      this.cancelActive = cancel
      signal.addEventListener('abort', abort, { once: true })
      audio.addEventListener('loadedmetadata', start, { once: true })
      audio.addEventListener('playing', onPlaying)
      audio.addEventListener('timeupdate', onTimeUpdate)
      audio.addEventListener('ended', finish)
      audio.addEventListener('error', onError)
      if (audio.readyState >= 1) start()
      else audio.load()
    })
  }

  setRate(rate: number) {
    this.rate = rate
    if (this.audio) this.audio.playbackRate = rate
  }

  async pause() {
    if (!this.audio || this.audio.paused) return false
    this.audio.pause()
    return true
  }

  async resume() {
    if (!this.audio || !this.audio.paused) return false
    try {
      await this.audio.play()
      return true
    } catch {
      return false
    }
  }

  async stop() {
    this.cancelActive?.()
    this.cancelActive = null
    this.releaseAudio()
  }
}
