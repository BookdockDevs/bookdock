import type { TtsEngine, TtsServiceRes } from '@bookdock/shared'

import type { BookReader, TtsSegment } from '../types'
import type { PlaybackClaim } from './playback-coordinator'
import { EdgeSpeechClient, ServiceAudioClient, SystemSpeechClient, type TtsClient, type TtsPreparedAudio, type TtsVoice } from './tts-client'

export type TtsStatus = 'idle' | 'starting' | 'playing' | 'paused' | 'error'

export interface TtsSessionState {
  status: TtsStatus
  engine: TtsEngine
  service: TtsServiceRes | null
  segment: TtsSegment | null
  highlighting: boolean
  voices: TtsVoice[]
  error: string | null
}

export interface TtsPreferences {
  engine: TtsEngine
  service?: TtsServiceRes
  voices?: TtsVoice[]
  voiceId: string
  rate: number
  autoNext: boolean
  highlight: boolean
}

interface BufferedQueueEntry {
  segment: TtsSegment
  prepared?: TtsPreparedAudio
  preparation?: Promise<void>
  error?: unknown
}

type BufferedTtsClient = TtsClient & {
  prepare: NonNullable<TtsClient['prepare']>
  playPrepared: NonNullable<TtsClient['playPrepared']>
}

type ScheduledTtsClient = BufferedTtsClient & {
  schedulePrepared: NonNullable<TtsClient['schedulePrepared']>
}

type Listener = () => void

const TTS_LOOKAHEAD = 4
const MAX_PREPARATIONS = 3
const MAX_PREPARED_CACHE = 12
const SENTENCE_GAP_SEC = 0.15

export class TtsController {
  private state: TtsSessionState
  private preferences: TtsPreferences
  private client: TtsClient
  private abortController: AbortController | null = null
  private generation = 0
  private restartPromise: Promise<void> | null = null
  private restartRequested = false
  private listeners = new Set<Listener>()
  private unbindInvalidation: (() => void) | null = null
  private bufferedQueue: BufferedQueueEntry[] = []
  private preparationGeneration = 0
  private activePreparations = 0
  private preparedCache = new Map<string, TtsPreparedAudio>()
  private activation?: () => Promise<PlaybackClaim>

  constructor(private renderer: BookReader, preferences: TtsPreferences, clientOverride?: TtsClient, activation?: () => Promise<PlaybackClaim>) {
    this.preferences = preferences
    this.client = clientOverride ?? this.createClient(preferences)
    this.activation = activation
    this.state = {
      status: 'idle',
      engine: preferences.engine,
      service: preferences.service ?? null,
      segment: null,
      highlighting: preferences.highlight,
      voices: this.client.listVoices(),
      error: null,
    }
    this.unbindInvalidation = renderer.on('ttsInvalidated', () => void this.stop())
  }

  getSnapshot = () => this.state

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  private createClient(preferences: TtsPreferences): TtsClient {
    if (preferences.engine === 'edge') return new EdgeSpeechClient()
    if (preferences.engine === 'service') return new ServiceAudioClient(preferences.service, preferences.voices)
    return new SystemSpeechClient()
  }

  private preferenceKey(preferences: TtsPreferences) {
    return `${preferences.engine}:${preferences.service?.id ?? ''}`
  }

  private isBufferedClient(client: TtsClient = this.client): client is BufferedTtsClient {
    return typeof client.prepare === 'function' && typeof client.playPrepared === 'function'
  }

  private isScheduledClient(client: TtsClient = this.client): client is ScheduledTtsClient {
    return this.isBufferedClient(client) && typeof client.schedulePrepared === 'function'
  }

  setPreferences(preferences: TtsPreferences) {
    const clientChanged = this.preferenceKey(preferences) !== this.preferenceKey(this.preferences)
    const voicesChanged = preferences.voices !== this.preferences.voices
    const rateChanged = preferences.rate !== this.preferences.rate
    const autoNextChanged = preferences.autoNext !== this.preferences.autoNext
    const playbackChanged = clientChanged || preferences.voiceId !== this.preferences.voiceId || rateChanged || autoNextChanged
    this.preferences = preferences
    const serviceVoicesChanged = preferences.engine === 'service' && voicesChanged
    if (clientChanged || serviceVoicesChanged) {
      const previousClient = this.client
      this.client = this.createClient(preferences)
      this.preparedCache.clear()
      this.state = { ...this.state, engine: preferences.engine, service: preferences.service ?? null, voices: this.client.listVoices() }
      if (clientChanged && this.state.status !== 'idle') {
        void previousClient.stop()
        void this.restartCurrent()
      }
    } else if (voicesChanged) {
      this.state = { ...this.state, voices: this.client.listVoices() }
    } else if (this.state.status === 'idle') {
      this.state = { ...this.state, voices: this.client.listVoices() }
    }
    if (this.state.highlighting !== preferences.highlight) {
      this.state = { ...this.state, highlighting: preferences.highlight }
      if (!preferences.highlight) this.renderer.clearTtsHighlight()
      else if (this.state.segment && this.state.status !== 'idle' && this.state.status !== 'error') void this.renderer.highlightTtsSegment(this.state.segment)
    }
    const canChangeRateLive = rateChanged && !clientChanged && !serviceVoicesChanged && this.isBufferedClient() && !this.isScheduledClient()
    if (canChangeRateLive) this.client.setRate?.(preferences.rate)
    if (playbackChanged && !clientChanged && !serviceVoicesChanged && !canChangeRateLive && this.state.status !== 'idle') void this.restartCurrent()
    this.emit()
  }

  refreshVoices() {
    const voices = this.client.listVoices()
    if (voices.length !== this.state.voices.length || voices.some((voice, index) => voice.id !== this.state.voices[index]?.id)) {
      this.state = { ...this.state, voices }
      this.emit()
    }
  }

  setHighlighting(highlighting: boolean) {
    if (this.state.highlighting === highlighting) return
    this.state = { ...this.state, highlighting }
    if (!highlighting) this.renderer.clearTtsHighlight()
    else if (this.state.segment && this.state.status !== 'idle' && this.state.status !== 'error') void this.renderer.highlightTtsSegment(this.state.segment)
    this.emit()
  }

  async toggle(startCfi?: string) {
    if (this.state.status === 'playing' || this.state.status === 'starting') return this.pause()
    if (this.state.status === 'paused') return this.resume()
    return this.start(startCfi)
  }

  async start(startCfi?: string) {
    void this.client.unlock?.()
    const claim = this.activation ? await this.activation() : undefined
    if (claim && (!claim.accepted || !claim.isCurrent())) return
    const segment = await this.renderer.getTtsSegment(startCfi)
    if (claim && !claim.isCurrent()) return
    if (!segment) {
      this.state = { ...this.state, status: 'error', error: '当前正文没有可朗读内容' }
      this.emit()
      return
    }
    await this.startPlayback(segment)
  }

  async startFromChapter() {
    void this.client.unlock?.()
    const claim = this.activation ? await this.activation() : undefined
    if (claim && (!claim.accepted || !claim.isCurrent())) return
    const segment = await this.renderer.getTtsChapterStartSegment()
    if (claim && !claim.isCurrent()) return
    if (!segment) {
      this.state = { ...this.state, status: 'error', error: '当前章节没有可朗读内容' }
      this.emit()
      return
    }
    await this.startPlayback(segment)
  }

  async pause() {
    if (this.state.status === 'starting') {
      await this.stop()
      return
    }
    if (this.state.status !== 'playing') return
    const paused = await this.client.pause()
    if (paused) {
      this.state = { ...this.state, status: 'paused' }
      this.emit()
      return
    }
    await this.restartCurrent()
  }

  async resume() {
    if (this.state.status !== 'paused' || !this.state.segment) return
    if (await this.client.resume()) {
      this.state = { ...this.state, status: 'playing', error: null }
      this.emit()
      return
    }
    await this.startPlayback(this.state.segment)
  }

  async stop() {
    await this.cancelPlayback()
    this.renderer.clearTtsHighlight()
    this.state = { ...this.state, status: 'idle', segment: null, error: null }
    this.emit()
  }

  async next() {
    await this.cancelPlayback()
    const segment = await this.renderer.nextTtsSegment()
    if (segment) await this.startPlayback(segment)
    else {
      this.state = { ...this.state, status: 'idle', segment: null }
      this.emit()
    }
  }

  async previous() {
    await this.cancelPlayback()
    const segment = await this.renderer.previousTtsSegment()
    if (segment) await this.startPlayback(segment)
    else {
      this.state = { ...this.state, status: 'idle', segment: null }
      this.emit()
    }
  }

  private async cancelPlayback() {
    this.generation++
    this.abortController?.abort()
    this.abortController = null
    this.bufferedQueue = []
    this.activePreparations = 0
    await this.client.stop()
  }

  private restartCurrent() {
    this.restartRequested = true
    this.abortController?.abort()
    if (this.restartPromise) return this.restartPromise
    const promise = this.runRestarts()
    this.restartPromise = promise
    void promise.then(
      () => this.finishRestart(promise),
      () => this.finishRestart(promise),
    )
    return promise
  }

  private async runRestarts() {
    while (this.restartRequested) {
      this.restartRequested = false
      const segment = this.state.segment
      if (!segment || this.state.status === 'idle') return
      await this.cancelPlayback()
      if (this.restartRequested) continue
      await this.startPlayback(segment)
    }
  }

  private finishRestart(promise: Promise<void>) {
    if (this.restartPromise !== promise) return
    this.restartPromise = null
    if (this.restartRequested) void this.restartCurrent()
  }

  private async startPlayback(segment: TtsSegment, preservePlaying = false) {
    const generation = ++this.generation
    this.abortController?.abort()
    this.bufferedQueue = []
    this.activePreparations = 0
    await this.client.stop()
    if (generation !== this.generation || this.restartRequested) return
    const controller = new AbortController()
    this.abortController = controller
    this.preparationGeneration = generation
    this.state = { ...this.state, status: preservePlaying && this.state.status === 'playing' ? 'playing' : 'starting', segment, error: null }
    this.emit()
    try {
      if (this.isBufferedClient()) await this.runBufferedSession(segment, generation, controller)
      else await this.playSystemSegment(segment, generation, controller)
    } catch {
      if (generation !== this.generation || controller.signal.aborted) return
      this.renderer.clearTtsHighlight()
      this.state = { ...this.state, status: 'error', error: 'reader.ttsPlaybackFailed' }
      this.emit()
    }
  }

  private async playSystemSegment(segment: TtsSegment, generation: number, controller: AbortController) {
    await this.client.speak(segment, { voiceId: this.preferences.voiceId, rate: this.preferences.rate }, controller.signal, {
      onStart: () => this.handleSegmentStart(segment, generation),
      onWordBoundary: () => undefined,
      onEnd: () => {
        if (generation === this.generation) void this.advance(generation)
      },
      onError: () => undefined,
    })
  }

  private handleSegmentStart(segment: TtsSegment, generation: number) {
    if (generation !== this.generation) return
    const navigation = this.preferences.autoNext ? this.renderer.revealTtsSegment(segment) : Promise.resolve()
    if (this.preferences.highlight) {
      void navigation.then(() => {
        if (generation === this.generation) void this.renderer.highlightTtsSegment(segment)
      })
    }
    this.state = { ...this.state, status: 'playing', segment, error: null }
    this.emit()
  }

  private preparedCacheKey(segment: TtsSegment) {
    return `${this.client.id}:${this.preferences.service?.id ?? ''}:${this.preferences.voiceId || this.preferences.service?.defaultVoice || ''}:${segment.id}`
  }

  private rememberPrepared(key: string, audio: TtsPreparedAudio) {
    this.preparedCache.delete(key)
    this.preparedCache.set(key, audio)
    while (this.preparedCache.size > MAX_PREPARED_CACHE) {
      const oldest = this.preparedCache.keys().next().value
      if (oldest === undefined) break
      this.preparedCache.delete(oldest)
    }
  }

  private async prepareEntry(entry: BufferedQueueEntry, generation: number, signal: AbortSignal, client: BufferedTtsClient) {
    const key = this.preparedCacheKey(entry.segment)
    const cached = this.preparedCache.get(key)
    if (cached) {
      entry.prepared = cached
      return
    }
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const audio = await client.prepare(entry.segment, { voiceId: this.preferences.voiceId, rate: 1 }, signal)
        if (generation !== this.generation || signal.aborted) return
        entry.prepared = audio
        this.rememberPrepared(key, audio)
        return
      } catch (error) {
        if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
        lastError = error
        if (attempt === 2) break
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            signal.removeEventListener('abort', abort)
            resolve()
          }, 200 * (attempt + 1))
          const abort = () => {
            window.clearTimeout(timer)
            signal.removeEventListener('abort', abort)
            reject(new DOMException('TTS preparation was aborted', 'AbortError'))
          }
          signal.addEventListener('abort', abort, { once: true })
        })
      }
    }
    throw lastError instanceof Error ? lastError : new Error('TTS preparation failed')
  }

  private pumpPreparations(generation: number) {
    const client = this.client
    if (generation !== this.generation || this.preparationGeneration !== generation || !this.abortController || !this.isBufferedClient(client)) return
    while (this.activePreparations < MAX_PREPARATIONS) {
      const entry = this.bufferedQueue.find((item) => !item.prepared && !item.preparation && !item.error)
      if (!entry) return
      this.activePreparations++
      entry.preparation = this.prepareEntry(entry, generation, this.abortController.signal, client)
      void entry.preparation.then(
        () => {
          if (generation !== this.generation) return
          this.activePreparations--
          this.pumpPreparations(generation)
        },
        (error: unknown) => {
          if (generation !== this.generation) return
          entry.error = error
          this.activePreparations--
          this.pumpPreparations(generation)
        },
      )
    }
  }

  private async extendBufferedQueue(generation: number) {
    try {
      const segments = await this.renderer.peekTtsSegments(TTS_LOOKAHEAD)
      if (generation !== this.generation) return
      const known = new Set(this.bufferedQueue.map((entry) => entry.segment.id))
      for (const segment of segments) {
        if (known.has(segment.id)) continue
        this.bufferedQueue.push({ segment })
        known.add(segment.id)
      }
      this.pumpPreparations(generation)
    } catch {
      // Lookahead is an optimization; the current segment must remain playable.
    }
  }

  private async waitForPrepared(entry: BufferedQueueEntry, generation: number) {
    while (!entry.prepared) {
      if (generation !== this.generation) return
      if (entry.error) throw entry.error
      this.pumpPreparations(generation)
      if (entry.preparation) {
        await entry.preparation
        continue
      }
      const pending = this.bufferedQueue.find((item) => item.preparation)?.preparation
      if (pending) await pending
      else await Promise.resolve()
    }
  }

  private async runBufferedSession(startSegment: TtsSegment, generation: number, controller: AbortController) {
    const client = this.client
    if (!this.isBufferedClient(client)) return
    if (this.isScheduledClient(client)) {
      await this.runScheduledBufferedSession(startSegment, generation, controller, client)
      return
    }
    this.bufferedQueue = [{ segment: startSegment }]
    void this.extendBufferedQueue(generation)
    this.pumpPreparations(generation)

    while (generation === this.generation && !controller.signal.aborted) {
      const current = this.bufferedQueue[0]
      if (!current) {
        this.renderer.clearTtsHighlight()
        this.state = { ...this.state, status: 'idle', segment: null }
        this.emit()
        return
      }
      await this.waitForPrepared(current, generation)
      if (generation !== this.generation || controller.signal.aborted || !current.prepared) return
      await client.playPrepared(current.segment, current.prepared, { voiceId: this.preferences.voiceId, rate: this.preferences.rate, gapSec: SENTENCE_GAP_SEC / Math.max(this.preferences.rate, 0.01) }, controller.signal, {
        onStart: () => this.handleSegmentStart(current.segment, generation),
        onWordBoundary: () => undefined,
        onEnd: () => undefined,
        onError: () => undefined,
      })
      if (generation !== this.generation || controller.signal.aborted) return
      this.bufferedQueue.shift()
      if (!this.preferences.autoNext) {
        this.renderer.clearTtsHighlight()
        this.state = { ...this.state, status: 'idle', segment: null }
        this.emit()
        return
      }
      const next = await this.renderer.nextTtsSegment()
      if (generation !== this.generation || controller.signal.aborted) return
      if (!next) {
        this.renderer.clearTtsHighlight()
        this.state = { ...this.state, status: 'idle', segment: null }
        this.emit()
        return
      }
      if (this.bufferedQueue[0]?.segment.id !== next.id) this.bufferedQueue.unshift({ segment: next })
      void this.extendBufferedQueue(generation)
      this.pumpPreparations(generation)
    }
  }

  private async runScheduledBufferedSession(startSegment: TtsSegment, generation: number, controller: AbortController, client: ScheduledTtsClient) {
    this.bufferedQueue = [{ segment: startSegment }]
    const scheduled = new Map<string, Promise<void>>()
    void this.extendBufferedQueue(generation)
    this.pumpPreparations(generation)

    while (generation === this.generation && !controller.signal.aborted) {
      const current = this.bufferedQueue[0]
      if (!current) {
        this.renderer.clearTtsHighlight()
        this.state = { ...this.state, status: 'idle', segment: null }
        this.emit()
        return
      }
      await this.waitForPrepared(current, generation)
      if (generation !== this.generation || controller.signal.aborted || !current.prepared) return

      const playbackOptions = {
        voiceId: this.preferences.voiceId,
        rate: this.preferences.rate,
        gapSec: SENTENCE_GAP_SEC / Math.max(this.preferences.rate, 0.01),
      }
      let playback = scheduled.get(current.segment.id)
      if (!playback) {
        playback = client.schedulePrepared(current.segment, current.prepared, playbackOptions, controller.signal, {
          onStart: () => this.handleSegmentStart(current.segment, generation),
          onWordBoundary: () => undefined,
          onEnd: () => undefined,
          onError: () => undefined,
        })
        scheduled.set(current.segment.id, playback)
      }

      const next = this.preferences.autoNext ? this.bufferedQueue[1] : undefined
      if (next && !scheduled.has(next.segment.id)) {
        try {
          await this.waitForPrepared(next, generation)
          if (generation !== this.generation || controller.signal.aborted || !next.prepared) return
          scheduled.set(next.segment.id, client.schedulePrepared(next.segment, next.prepared, playbackOptions, controller.signal, {
            onStart: () => this.handleSegmentStart(next.segment, generation),
            onWordBoundary: () => undefined,
            onEnd: () => undefined,
            onError: () => undefined,
          }))
        } catch {
          // The current sentence remains audible; the failed next sentence is
          // surfaced by waitForPrepared when it becomes the head of the queue.
        }
      }

      try {
        await playback
      } catch (error) {
        if (generation !== this.generation || controller.signal.aborted) return
        throw error
      }
      if (generation !== this.generation || controller.signal.aborted) return
      scheduled.delete(current.segment.id)
      this.bufferedQueue.shift()
      if (!this.preferences.autoNext) {
        this.renderer.clearTtsHighlight()
        this.state = { ...this.state, status: 'idle', segment: null }
        this.emit()
        return
      }
      const committed = await this.renderer.nextTtsSegment()
      if (generation !== this.generation || controller.signal.aborted) return
      if (!committed) {
        this.renderer.clearTtsHighlight()
        this.state = { ...this.state, status: 'idle', segment: null }
        this.emit()
        return
      }
      if (this.bufferedQueue[0]?.segment.id !== committed.id) this.bufferedQueue.unshift({ segment: committed })
      void this.extendBufferedQueue(generation)
      this.pumpPreparations(generation)
    }
  }

  private async advance(generation: number) {
    if (!this.preferences.autoNext || generation !== this.generation) {
      this.renderer.clearTtsHighlight()
      this.state = { ...this.state, status: 'idle', segment: null }
      this.emit()
      return
    }
    const controller = this.abortController
    if (controller) {
      await new Promise<void>((resolve) => {
        if (controller.signal.aborted) {
          resolve()
          return
        }
        const delay = window.setTimeout(() => {
          controller.signal.removeEventListener('abort', abort)
          resolve()
        }, (SENTENCE_GAP_SEC / Math.max(this.preferences.rate, 0.01)) * 1000)
        const abort = () => {
          window.clearTimeout(delay)
          controller.signal.removeEventListener('abort', abort)
          resolve()
        }
        controller.signal.addEventListener('abort', abort, { once: true })
      })
    }
    if (generation !== this.generation || this.abortController?.signal.aborted) return
    const next = await this.renderer.nextTtsSegment()
    if (generation !== this.generation) return
    if (!next) {
      this.renderer.clearTtsHighlight()
      this.state = { ...this.state, status: 'idle', segment: null }
      this.emit()
      return
    }
    await this.startPlayback(next, true)
  }

  dispose() {
    this.unbindInvalidation?.()
    void this.stop()
    this.listeners.clear()
  }
}
