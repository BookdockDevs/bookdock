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
      if (voice) utterance.voice = voice
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
      globalThis.speechSynthesis.cancel()
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
    globalThis.speechSynthesis?.cancel()
    this.paused = false
    this.utterance = null
  }
}

const EDGE_API_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const EDGE_SPEECH_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
const EDGE_CHROMIUM_VERSION = '143.0.3650.75'

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

function edgeLanguage(voice: string) {
  const parts = voice.split('-')
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'zh-CN'
}

async function edgeGec() {
  const windowsEpochSeconds = 11644473600
  let seconds = Math.floor(Date.now() / 1000) + windowsEpochSeconds
  seconds -= seconds % 300
  const ticks = seconds * 10_000_000
  const data = new TextEncoder().encode(`${ticks}${EDGE_API_TOKEN}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function edgeFrame(headers: Record<string, string>, body: string) {
  return `${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n${body}`
}

function edgeMessage(message: string) {
  const separator = message.indexOf('\n\n')
  const headerPart = separator >= 0 ? message.slice(0, separator) : message
  const body = separator >= 0 ? message.slice(separator + 2) : ''
  const headers: Record<string, string> = {}
  for (const line of headerPart.split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim()
  }
  return { path: headers.path, body }
}

function edgeSsml(text: string, voice: string, rate: number) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  const lang = edgeLanguage(voice)
  const relativeRate = `${rate >= 1 ? '+' : ''}${Math.round((rate - 1) * 100)}%`
  return `<speak version="1.0" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${relativeRate}" pitch="0Hz">${escaped}</prosody></voice></speak>`
}

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
    const blob = await this.fetchAudio(segment.text, voice, 1, signal)
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

  private async fetchAudio(text: string, voice: string, rate: number, signal: AbortSignal) {
    const connectionId = crypto.randomUUID().replaceAll('-', '')
    const params = new URLSearchParams({ ConnectionId: connectionId, TrustedClientToken: EDGE_API_TOKEN, 'Sec-MS-GEC': await edgeGec(), 'Sec-MS-GEC-Version': `1-${EDGE_CHROMIUM_VERSION}` })
    const socket = new WebSocket(`${EDGE_SPEECH_URL}?${params}`)
    socket.binaryType = 'arraybuffer'
    const config = edgeFrame({ 'Content-Type': 'application/json; charset=utf-8', Path: 'speech.config', 'X-Timestamp': new Date().toString() }, JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } }))
    const content = edgeFrame({ 'Content-Type': 'application/ssml+xml', Path: 'ssml', 'X-RequestId': connectionId, 'X-Timestamp': new Date().toString() }, edgeSsml(text, voice, rate))
    return new Promise<Blob>((resolve, reject) => {
      const chunks: ArrayBuffer[] = []
      let pendingBinary: Promise<void> = Promise.resolve()
      let turnEnded = false
      let settled = false
      let closeTimer: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        signal.removeEventListener('abort', abort)
        if (closeTimer) clearTimeout(closeTimer)
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const finish = () => {
        if (settled) return
        settled = true
        cleanup()
        if (!chunks.length) { reject(new Error('Edge TTS returned no audio')); return }
        resolve(new Blob(chunks, { type: 'audio/mpeg' }))
      }
      const finishAfterBinary = () => {
        pendingBinary.then(finish).catch(() => fail(new Error('Edge TTS returned an invalid audio frame')))
      }
      const abort = () => fail(abortedError())
      signal.addEventListener('abort', abort, { once: true })
      closeTimer = setTimeout(() => fail(new Error('Edge TTS request timed out')), 30_000)
      socket.onopen = () => { socket.send(config); socket.send(content) }
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const message = edgeMessage(event.data)
          if (message.path === 'turn.end') { turnEnded = true; finishAfterBinary() }
          return
        }
        const read = async () => {
          const buffer = event.data instanceof ArrayBuffer ? event.data : await (event.data as Blob).arrayBuffer()
          if (buffer.byteLength < 2) return
          const headerLength = new DataView(buffer).getInt16(0)
          if (buffer.byteLength > headerLength + 2) chunks.push(buffer.slice(headerLength + 2))
        }
        pendingBinary = pendingBinary.then(read)
        void pendingBinary.catch(() => fail(new Error('Edge TTS returned an invalid audio frame')))
      }
      socket.onerror = () => fail(new Error('Edge TTS connection failed'))
      socket.onclose = () => { if (!settled && turnEnded) finishAfterBinary() }
    })
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
