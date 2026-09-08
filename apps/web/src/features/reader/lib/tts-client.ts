import type { TtsServiceRes } from '@bookdock/shared'

import { apiPostBlob } from '@/api/client'

import type { TtsSegment } from '../types'
import { TtsAudioBufferPlayer, type DecodedTtsAudio } from './tts-audio-buffer'

export interface TtsVoice {
  id: string
  name: string
  lang: string
  gender?: string
  description?: string
}

export interface TtsPlaybackEvents {
  onStart: () => void
  onWordBoundary: (start: number, length: number) => void
  onEnd: () => void
  onError: (error: Error) => void
}

export interface TtsSpeakOptions {
  voiceId: string
  rate: number
  gapSec?: number
}

export type TtsPreparedAudio = DecodedTtsAudio

export interface TtsClient {
  readonly id: 'system' | 'edge' | 'service'
  readonly pauseResume: boolean
  listVoices(): TtsVoice[]
  speak(segment: TtsSegment, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents): Promise<void>
  prepare?(segment: TtsSegment, options: TtsSpeakOptions, signal: AbortSignal): Promise<TtsPreparedAudio>
  playPrepared?(segment: TtsSegment, audio: TtsPreparedAudio, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents): Promise<void>
  schedulePrepared?(segment: TtsSegment, audio: TtsPreparedAudio, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents): Promise<void>
  unlock?(): Promise<void>
  setRate?(rate: number): void
  pause(): Promise<boolean>
  resume(): Promise<boolean>
  stop(): Promise<void>
}

function abortedError() {
  return new DOMException('Speech request was aborted', 'AbortError')
}

export class SystemSpeechClient implements TtsClient {
  readonly id = 'system' as const
  readonly pauseResume = typeof globalThis.speechSynthesis?.pause === 'function'
  private utterance: SpeechSynthesisUtterance | null = null
  private paused = false

  listVoices(): TtsVoice[] {
    return (globalThis.speechSynthesis?.getVoices?.() ?? []).map((voice) => ({
      id: voice.voiceURI || voice.name,
      name: voice.name,
      lang: voice.lang,
    }))
  }

  speak(segment: TtsSegment, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents): Promise<void> {
    if (!globalThis.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      return Promise.reject(new Error('System speech is unavailable in this browser'))
    }
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(segment.text)
      this.utterance = utterance
      this.paused = false
      utterance.rate = options.rate
      const voice = globalThis.speechSynthesis.getVoices().find((item) => (item.voiceURI || item.name) === options.voiceId)
      if (voice) {
        utterance.voice = voice
        if (voice.lang) utterance.lang = voice.lang
      }
      let settled = false
      const cleanup = () => {
        signal.removeEventListener('abort', abort)
        if (this.utterance === utterance) this.utterance = null
      }
      const finish = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const abort = () => {
        globalThis.speechSynthesis?.cancel()
        fail(abortedError())
      }
      utterance.onstart = () => {
        this.paused = false
        events.onStart()
      }
      utterance.onboundary = (event) => {
        if (Number.isFinite(event.charIndex) && event.charLength > 0) events.onWordBoundary(event.charIndex, event.charLength)
      }
      utterance.onend = () => {
        this.paused = false
        events.onEnd()
        finish()
      }
      utterance.onerror = (event) => {
        this.paused = false
        if (signal.aborted || event.error === 'canceled' || event.error === 'interrupted') {
          fail(abortedError())
        } else {
          const error = new Error(`System speech failed: ${event.error}`)
          events.onError(error)
          fail(error)
        }
      }
      signal.addEventListener('abort', abort, { once: true })
      globalThis.speechSynthesis.speak(utterance)
    })
  }

  async pause() {
    const synthesis = globalThis.speechSynthesis
    if (!this.pauseResume || !this.utterance || !synthesis) return false
    if (synthesis.speaking || synthesis.pending) {
      synthesis.pause()
    } else {
      synthesis.cancel()
    }
    this.paused = true
    return true
  }

  async resume() {
    const synthesis = globalThis.speechSynthesis
    if (!this.pauseResume || !this.utterance || !this.paused || !synthesis) return false
    if (!synthesis.paused && !synthesis.speaking && !synthesis.pending) return false
    synthesis.resume()
    this.paused = false
    return true
  }

  async stop() {
    const synthesis = globalThis.speechSynthesis
    if (this.utterance || synthesis?.speaking || synthesis?.pending) synthesis?.cancel()
    this.paused = false
    this.utterance = null
  }
}

const EDGE_VOICES: TtsVoice[] = [
  { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao', lang: 'zh-CN' },
  { id: 'zh-CN-YunxiNeural', name: 'Yunxi', lang: 'zh-CN' },
  { id: 'zh-CN-YunjianNeural', name: 'Yunjian', lang: 'zh-CN' },
  { id: 'zh-CN-XiaoyiNeural', name: 'Xiaoyi', lang: 'zh-CN' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', name: 'Xiaobei', lang: 'zh-CN' },
  { id: 'zh-TW-HsiaoChenNeural', name: 'HsiaoChen', lang: 'zh-TW' },
  { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' },
  { id: 'en-US-GuyNeural', name: 'Guy', lang: 'en-US' },
  { id: 'en-US-JennyNeural', name: 'Jenny', lang: 'en-US' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', lang: 'en-GB' },
  { id: 'ja-JP-NanamiNeural', name: 'Nanami', lang: 'ja-JP' },
  { id: 'ko-KR-SunHiNeural', name: 'SunHi', lang: 'ko-KR' },
]

export class EdgeSpeechClient implements TtsClient {
  readonly id = 'edge' as const
  readonly pauseResume = true
  private readonly audioPlayer = new TtsAudioBufferPlayer()

  listVoices() {
    return EDGE_VOICES
  }

  async unlock() { await this.audioPlayer.unlock() }

  async prepare(segment: TtsSegment, options: TtsSpeakOptions, signal: AbortSignal) {
    const voice = options.voiceId || EDGE_VOICES[0].id
    const blob = await apiPostBlob('/tts/edge/speech', { text: segment.text, voice, rate: 1 }, signal)
    if (signal.aborted) throw abortedError()
    return this.audioPlayer.decode(await blob.arrayBuffer())
  }

  async playPrepared(_segment: TtsSegment, audio: TtsPreparedAudio, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents) {
    await this.audioPlayer.play(audio, options.rate, signal, events, options.gapSec)
  }

  async schedulePrepared(_segment: TtsSegment, audio: TtsPreparedAudio, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents) {
    await this.audioPlayer.schedule(audio, options.rate, signal, events, options.gapSec)
  }

  async speak(segment: TtsSegment, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents) {
    const audio = await this.prepare(segment, options, signal)
    await this.playPrepared(segment, audio, options, signal, events)
  }

  setRate(rate: number) {
    this.audioPlayer.setRate(rate)
  }

  async pause() { return this.audioPlayer.pause() }
  async resume() { return this.audioPlayer.resume() }
  async stop() { await this.audioPlayer.stop() }
}

export class ServiceAudioClient implements TtsClient {
  readonly id = 'service' as const
  readonly pauseResume = true
  private readonly audioPlayer = new TtsAudioBufferPlayer()

  constructor(private service: TtsServiceRes | undefined, private voices: TtsVoice[] = []) {}

  listVoices() {
    if (this.voices.length) return this.voices
    const voice = this.service?.defaultVoice
    return voice ? [{ id: voice, name: voice, lang: '' }] : []
  }

  async unlock() { await this.audioPlayer.unlock() }

  async prepare(segment: TtsSegment, options: TtsSpeakOptions, signal: AbortSignal) {
    if (!this.service?.credentialsConfigured) throw new Error('TTS service is not configured')
    const blob = await apiPostBlob('/tts/speech', { serviceId: this.service.id, text: segment.text, voice: options.voiceId || this.service.defaultVoice || undefined, rate: 1 }, signal)
    if (signal.aborted) throw abortedError()
    return this.audioPlayer.decode(await blob.arrayBuffer())
  }

  async playPrepared(_segment: TtsSegment, audio: TtsPreparedAudio, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents) {
    await this.audioPlayer.play(audio, options.rate, signal, events, options.gapSec)
  }

  async schedulePrepared(_segment: TtsSegment, audio: TtsPreparedAudio, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents) {
    await this.audioPlayer.schedule(audio, options.rate, signal, events, options.gapSec)
  }

  async speak(segment: TtsSegment, options: TtsSpeakOptions, signal: AbortSignal, events: TtsPlaybackEvents) {
    const audio = await this.prepare(segment, options, signal)
    await this.playPrepared(segment, audio, options, signal, events)
  }

  setRate(rate: number) { this.audioPlayer.setRate(rate) }

  async pause() { return this.audioPlayer.pause() }
  async resume() { return this.audioPlayer.resume() }
  async stop() { await this.audioPlayer.stop() }
}
