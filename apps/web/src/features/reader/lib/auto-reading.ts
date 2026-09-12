import type { AutoReadingMode, BookReader, ReadingMode } from '../types'
import type { PlaybackClaim } from './playback-coordinator'

export type { AutoReadingMode }
export type AutoReadingStatus = 'idle' | 'running' | 'paused'

export interface AutoReadingPreferences {
  mode: AutoReadingMode
  speed: number
  readingMode: ReadingMode
}

export interface AutoReadingSessionState {
  status: AutoReadingStatus
  mode: AutoReadingMode
  speed: number
  error: string | null
  stepStartedAt: number | null
  stepDuration: number | null
  stepRemaining: number | null
}

type Listener = () => void

const DEFAULT_SPEED = 30
const MIN_SPEED = 1
const MAX_SPEED = 100
const USER_INTERACTION_SETTLE_MS = 250

export function clampAutoReadingSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return DEFAULT_SPEED
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, Math.round(speed)))
}

export function smoothPixelsPerSecond(speed: number): number {
  const normalized = (clampAutoReadingSpeed(speed) - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)
  return 5 + 115 * Math.pow(normalized, 1.55)
}

export function timedSecondsPerStep(speed: number): number {
  const normalized = (clampAutoReadingSpeed(speed) - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)
  return 120 * Math.pow(2 / 120, Math.pow(normalized, 0.7))
}

export interface AutoReadingControllerOptions {
  claim?: () => Promise<PlaybackClaim>
}

export class AutoReadingController {
  private preferences: AutoReadingPreferences
  private state: AutoReadingSessionState
  private listeners = new Set<Listener>()
  private frame: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private lastFrameAt = 0
  private smoothDistanceRemainder = 0
  private interactionResumeTimer: ReturnType<typeof setTimeout> | null = null
  private waitingForInteraction = false
  private navigationPending = false
  private claim: PlaybackClaim | null = null
  private unbinders: (() => void)[] = []

  constructor(
    private renderer: BookReader,
    preferences: AutoReadingPreferences,
    private options: AutoReadingControllerOptions = {},
  ) {
    this.preferences = { ...preferences, speed: clampAutoReadingSpeed(preferences.speed) }
    this.state = {
      status: 'idle',
      mode: this.effectiveMode(this.preferences),
      speed: this.preferences.speed,
      error: null,
      stepStartedAt: null,
      stepDuration: null,
      stepRemaining: null,
    }
    this.unbinders.push(
      renderer.on('userJump', () => this.rebaseAfterUserInteraction()),
      renderer.on('userInteraction', () => this.rebaseAfterUserInteraction()),
      renderer.on('userInteractionEnd', () => this.scheduleInteractionResume()),
      renderer.on('textSelectionStart', () => void this.pause()),
      renderer.on('navigatePending', ({ pending }) => {
        this.navigationPending = pending
        if (!pending && this.waitingForInteraction && this.interactionResumeTimer === null) {
          this.scheduleInteractionResume()
        }
      }),
      renderer.on('readingSettingsChanged', () => void this.pause()),
    )
    if (typeof document !== 'undefined') {
      const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') void this.pause()
      }
      document.addEventListener('visibilitychange', onVisibilityChange)
      this.unbinders.push(() => document.removeEventListener('visibilitychange', onVisibilityChange))
    }
  }

  getSnapshot = () => this.state

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  private effectiveMode(preferences: AutoReadingPreferences): AutoReadingMode {
    return preferences.readingMode === 'page' ? 'timed' : preferences.mode
  }

  setPreferences(preferences: AutoReadingPreferences) {
    const next = { ...preferences, speed: clampAutoReadingSpeed(preferences.speed) }
    const modeChanged = this.effectiveMode(next) !== this.state.mode
    const readingModeChanged = next.readingMode !== this.preferences.readingMode
    const speedChanged = next.speed !== this.preferences.speed
    this.preferences = next
    this.state = { ...this.state, mode: this.effectiveMode(next), speed: next.speed }

    if (readingModeChanged) void this.pause()
    else if (modeChanged && this.state.status === 'running' && !this.waitingForInteraction) {
      this.generation++
      this.cancelInteractionResume()
      this.cancelLoop()
      this.lastFrameAt = 0
      this.smoothDistanceRemainder = 0
      this.renderer.setAutoReadingActive(false)
      this.startLoop(this.generation)
    }
    else if (speedChanged && this.state.status === 'running' && !this.waitingForInteraction) {
      if (this.state.mode === 'timed') {
        this.clearTimer()
        this.state = { ...this.state, stepRemaining: null, stepDuration: null, stepStartedAt: null }
        this.scheduleTimedStep(this.generation)
      }
    }
    else if (speedChanged && this.state.status === 'paused') {
      if (this.state.mode === 'timed' && this.state.stepRemaining !== null && this.state.stepDuration) {
        const progress = (this.state.stepDuration - this.state.stepRemaining) / this.state.stepDuration
        const newDuration = timedSecondsPerStep(next.speed) * 1000
        const newRemaining = Math.max(0, Math.round(newDuration * (1 - progress)))
        this.state = { ...this.state, stepDuration: newDuration, stepRemaining: newRemaining }
      }
    }
    this.emit()
  }

  async start() {
    if (this.state.status === 'running') return
    if (this.state.status === 'paused') {
      await this.resume()
      return
    }
    const claim = await this.options.claim?.()
    if (claim && !claim.accepted) return
    this.claim = claim ?? null
    if (!this.isClaimCurrent()) return

    this.cancelInteractionResume()
    const generation = ++this.generation
    this.state = { ...this.state, status: 'running', error: null }
    this.emit()
    this.startLoop(generation)
  }

  async pause() {
    if (this.state.status !== 'running') return
    this.generation++
    this.cancelInteractionResume()
    this.cancelLoop()
    this.renderer.setAutoReadingActive(false)
    let stepRemaining: number | null = null
    if (this.state.mode === 'timed' && this.state.stepStartedAt && this.state.stepDuration) {
      const elapsed = Date.now() - this.state.stepStartedAt
      stepRemaining = Math.max(0, this.state.stepDuration - elapsed)
    }
    this.state = {
      ...this.state,
      status: 'paused',
      stepStartedAt: null,
      stepRemaining,
    }
    this.emit()
  }

  async resume() {
    if (this.state.status !== 'paused') return
    if (this.preferences.readingMode === 'page' || this.state.mode === 'timed') {
      const claim = await this.options.claim?.()
      if (claim && !claim.accepted) return
      this.claim = claim ?? this.claim
    }
    if (!this.isClaimCurrent()) return
    this.cancelInteractionResume()
    const generation = ++this.generation
    this.state = { ...this.state, status: 'running', error: null }
    this.emit()
    this.startLoop(generation)
  }

  async stop() {
    this.generation++
    this.cancelInteractionResume()
    this.cancelLoop()
    this.renderer.setAutoReadingActive(false)
    this.state = {
      ...this.state,
      status: 'idle',
      error: null,
      stepStartedAt: null,
      stepDuration: null,
      stepRemaining: null,
    }
    this.claim = null
    this.emit()
  }

  private isClaimCurrent() {
    return !this.claim || this.claim.isCurrent()
  }

  private startLoop(generation: number) {
    if (this.state.mode === 'smooth') {
      this.renderer.setAutoReadingActive(true)
      this.lastFrameAt = 0
      this.smoothDistanceRemainder = 0
      this.state = { ...this.state, stepStartedAt: null, stepDuration: null, stepRemaining: null }
      this.scheduleSmoothFrame(generation)
    } else {
      this.scheduleTimedStep(generation)
    }
  }

  private rebaseAfterUserInteraction() {
    if (this.state.status !== 'running') return
    this.generation++
    this.cancelLoop()
    this.lastFrameAt = 0
    this.smoothDistanceRemainder = 0
    this.waitingForInteraction = true
    if (this.state.mode === 'timed') {
      this.state = { ...this.state, stepStartedAt: null, stepDuration: null, stepRemaining: null }
      this.emit()
    }
    this.scheduleInteractionResume()
  }

  private scheduleInteractionResume() {
    if (!this.waitingForInteraction || this.state.status !== 'running') return
    if (this.interactionResumeTimer !== null) clearTimeout(this.interactionResumeTimer)
    const generation = this.generation
    this.interactionResumeTimer = setTimeout(() => {
      this.interactionResumeTimer = null
      if (this.navigationPending) return
      if (generation !== this.generation || this.state.status !== 'running' || !this.isClaimCurrent()) return
      this.waitingForInteraction = false
      this.startLoop(generation)
    }, USER_INTERACTION_SETTLE_MS)
  }

  private cancelInteractionResume() {
    if (this.interactionResumeTimer !== null) {
      clearTimeout(this.interactionResumeTimer)
      this.interactionResumeTimer = null
    }
    this.waitingForInteraction = false
  }

  private requestFrame(callback: (now: number) => void): number {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame(callback)
    }
    return window.setTimeout(() => callback(Date.now()), 16)
  }

  private cancelFrame(frame: number) {
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(frame)
      return
    }
    window.clearTimeout(frame)
  }

  private scheduleSmoothFrame(generation: number) {
    if (this.frame !== null || generation !== this.generation) return
    this.frame = this.requestFrame((now) => {
      this.frame = null
      if (generation !== this.generation || this.state.status !== 'running' || !this.isClaimCurrent()) return
      const elapsed = this.lastFrameAt === 0 ? 0 : Math.min(100, Math.max(0, now - this.lastFrameAt))
      this.lastFrameAt = now
      const distance = smoothPixelsPerSecond(this.state.speed) * elapsed / 1000 + this.smoothDistanceRemainder
      const scrollDistance = Math.floor(distance)
      this.smoothDistanceRemainder = distance - scrollDistance
      Promise.resolve()
        .then(() => scrollDistance > 0 ? this.renderer.scrollByPixels(scrollDistance) : undefined)
        .then(() => {
          if (generation !== this.generation || this.state.status !== 'running' || !this.isClaimCurrent()) return
          if (this.renderer.isAtEnd()) {
            void this.stop()
            return
          }
          this.scheduleSmoothFrame(generation)
        })
        .catch(() => this.fail(generation))
    })
  }

  private scheduleTimedStep(generation: number) {
    if (this.timer !== null || generation !== this.generation) return
    const isResumed = this.state.stepRemaining !== null
    const totalDuration = isResumed
      ? (this.state.stepDuration ?? timedSecondsPerStep(this.state.speed) * 1000)
      : timedSecondsPerStep(this.state.speed) * 1000
    const duration = isResumed ? this.state.stepRemaining! : totalDuration
    const stepStartedAt = Date.now() - (totalDuration - duration)

    this.state = {
      ...this.state,
      stepStartedAt,
      stepDuration: totalDuration,
      stepRemaining: null,
    }
    this.emit()

    this.timer = setTimeout(() => {
      this.timer = null
      void this.runTimedStep(generation)
    }, duration)
  }

  private async runTimedStep(generation: number) {
    if (generation !== this.generation || this.state.status !== 'running' || !this.isClaimCurrent()) return
    if (this.renderer.isAtEnd()) {
      await this.stop()
      return
    }
    try {
      await this.renderer.scrollByPages(1, undefined, { internal: true })
      if (generation !== this.generation || this.state.status !== 'running' || !this.isClaimCurrent()) return
      if (this.renderer.isAtEnd()) {
        await this.stop()
        return
      }
      this.scheduleTimedStep(generation)
    } catch {
      this.fail(generation)
    }
  }

  private fail(generation: number) {
    if (generation !== this.generation) return
    this.cancelInteractionResume()
    this.cancelLoop()
    this.renderer.setAutoReadingActive(false)
    this.state = {
      ...this.state,
      status: 'idle',
      error: 'reader.autoReadingFailed',
      stepStartedAt: null,
      stepDuration: null,
      stepRemaining: null,
    }
    this.claim = null
    this.emit()
  }

  private clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private cancelLoop() {
    if (this.frame !== null) {
      this.cancelFrame(this.frame)
      this.frame = null
    }
    this.clearTimer()
  }

  dispose() {
    this.unbinders.forEach((unbind) => unbind())
    this.unbinders = []
    void this.stop()
    this.listeners.clear()
  }
}
