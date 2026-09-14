import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AutoReadingController, smoothPixelsPerSecond, timedSecondsPerStep } from '../auto-reading'
import { ReaderPlaybackCoordinator } from '../playback-coordinator'
import type { BookReader } from '../../types'

function fakeRenderer() {
  const listeners = new Map<string, (data?: unknown) => void>()
  let atEnd = false
  const renderer = {
    on: vi.fn((type: string, listener: () => void) => {
      listeners.set(type, listener)
      return () => listeners.delete(type)
    }),
    isAtEnd: vi.fn(() => atEnd),
    scrollByPages: vi.fn(async () => { atEnd = true }),
    scrollByPixels: vi.fn(async () => undefined),
    setAutoReadingActive: vi.fn(),
  } as unknown as BookReader
  return {
    renderer,
    emit(type: string, data?: unknown) { listeners.get(type)?.(data) },
  }
}

describe('auto reading speed mapping', () => {
  it('keeps both speed curves monotonic with the documented bounds', () => {
    expect(smoothPixelsPerSecond(1)).toBe(5)
    expect(smoothPixelsPerSecond(100)).toBe(120)
    expect(timedSecondsPerStep(1)).toBe(120)
    expect(timedSecondsPerStep(100)).toBe(2)
    expect(smoothPixelsPerSecond(30)).toBeLessThan(smoothPixelsPerSecond(31))
    expect(timedSecondsPerStep(30)).toBeGreaterThan(timedSecondsPerStep(31))
  })
})

describe('AutoReadingController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pauses on a layout change and rebases on a direct user interaction', async () => {
    const fake = fakeRenderer()
    const controller = new AutoReadingController(fake.renderer, { mode: 'smooth', speed: 30, readingMode: 'scroll' })
    await controller.start()
    expect(controller.getSnapshot().status).toBe('running')

    fake.emit('readingSettingsChanged')
    expect(controller.getSnapshot().status).toBe('paused')
    await controller.resume()
    fake.emit('userInteraction')
    expect(controller.getSnapshot().status).toBe('running')
    await vi.advanceTimersByTimeAsync(300)
    expect(controller.getSnapshot().status).toBe('running')

    await controller.stop()
    expect(controller.getSnapshot().status).toBe('idle')
    controller.dispose()
  })

  it('waits for a pending navigation to settle before resuming', async () => {
    const fake = fakeRenderer()
    const controller = new AutoReadingController(fake.renderer, { mode: 'timed', speed: 100, readingMode: 'page' })
    await controller.start()

    fake.emit('userInteraction')
    fake.emit('navigatePending', { pending: true })
    await vi.advanceTimersByTimeAsync(500)
    expect(fake.renderer.scrollByPages).not.toHaveBeenCalled()

    fake.emit('navigatePending', { pending: false })
    await vi.advanceTimersByTimeAsync(249)
    expect(fake.renderer.scrollByPages).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(controller.getSnapshot().status).toBe('running')

    await controller.stop()
    controller.dispose()
  })

  it('switches movement modes without pausing', async () => {
    const fake = fakeRenderer()
    const controller = new AutoReadingController(fake.renderer, { mode: 'smooth', speed: 100, readingMode: 'scroll' })
    await controller.start()

    controller.setPreferences({ mode: 'timed', speed: 100, readingMode: 'scroll' })

    expect(controller.getSnapshot()).toMatchObject({ status: 'running', mode: 'timed', speed: 100 })
    expect(fake.renderer.setAutoReadingActive).toHaveBeenNthCalledWith(1, true)
    expect(fake.renderer.setAutoReadingActive).toHaveBeenNthCalledWith(2, false)
    expect(fake.renderer.scrollByPages).not.toHaveBeenCalled()

    await controller.stop()
    controller.dispose()
  })

  it('pauses when text selection starts and waits for an explicit resume', async () => {
    const fake = fakeRenderer()
    const controller = new AutoReadingController(fake.renderer, { mode: 'timed', speed: 100, readingMode: 'page' })
    await controller.start()

    fake.emit('textSelectionStart')
    expect(controller.getSnapshot().status).toBe('paused')
    await vi.advanceTimersByTimeAsync(3000)
    expect(fake.renderer.scrollByPages).not.toHaveBeenCalled()

    await controller.resume()
    expect(controller.getSnapshot().status).toBe('running')
    await controller.stop()
    controller.dispose()
  })

  it('accumulates subpixel smooth movement at normal speeds', async () => {
    const fake = fakeRenderer()
    const controller = new AutoReadingController(fake.renderer, { mode: 'smooth', speed: 30, readingMode: 'scroll' })
    await controller.start()

    await vi.advanceTimersByTimeAsync(150)

    expect(fake.renderer.scrollByPixels).toHaveBeenCalled()
    expect(fake.renderer.scrollByPixels.mock.calls.every(([distance]) => Number.isInteger(distance))).toBe(true)
    await controller.stop()
    controller.dispose()
  })

  it('stops smooth auto reading when the active mode blocks a chapter crossing', async () => {
    const fake = fakeRenderer()
    fake.renderer.scrollByPixels = vi.fn(async () => false)
    const controller = new AutoReadingController(fake.renderer, { mode: 'smooth', speed: 30, readingMode: 'scroll' })

    await controller.start()
    await vi.advanceTimersByTimeAsync(150)

    expect(controller.getSnapshot().status).toBe('idle')
    expect(fake.renderer.scrollByPixels).toHaveBeenCalled()
    controller.dispose()
  })

  it('waits between timed advances and stops at the end', async () => {
    const fake = fakeRenderer()
    const controller = new AutoReadingController(fake.renderer, { mode: 'timed', speed: 100, readingMode: 'page' })
    await controller.start()
    expect(fake.renderer.scrollByPages).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1999)
    expect(fake.renderer.scrollByPages).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(fake.renderer.scrollByPages).toHaveBeenCalledWith(1, undefined, { internal: true })
    expect(controller.getSnapshot().status).toBe('idle')
    controller.dispose()
  })

  it('tracks step timing and handles pause and resume with remaining duration', async () => {
    const fake = fakeRenderer()
    const controller = new AutoReadingController(fake.renderer, { mode: 'timed', speed: 100, readingMode: 'page' })
    await controller.start()

    const initialSnap = controller.getSnapshot()
    expect(initialSnap.status).toBe('running')
    expect(initialSnap.stepDuration).toBe(2000)
    expect(typeof initialSnap.stepStartedAt).toBe('number')
    expect(initialSnap.stepRemaining).toBeNull()

    // Advance 800ms (remaining should be 1200ms)
    vi.advanceTimersByTime(800)
    await controller.pause()

    const pausedSnap = controller.getSnapshot()
    expect(pausedSnap.status).toBe('paused')
    expect(pausedSnap.stepStartedAt).toBeNull()
    expect(pausedSnap.stepDuration).toBe(2000)
    expect(pausedSnap.stepRemaining).toBe(1200)

    // Ensure no advance happens while paused
    vi.advanceTimersByTime(5000)
    expect(fake.renderer.scrollByPages).not.toHaveBeenCalled()

    // Resume: should resume with remaining 1200ms
    await controller.resume()
    const resumedSnap = controller.getSnapshot()
    expect(resumedSnap.status).toBe('running')
    expect(resumedSnap.stepDuration).toBe(2000)
    expect(resumedSnap.stepRemaining).toBeNull()
    expect(typeof resumedSnap.stepStartedAt).toBe('number')

    vi.advanceTimersByTime(1199)
    expect(fake.renderer.scrollByPages).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(fake.renderer.scrollByPages).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('invalidates an older start when another playback owner claims the reader', async () => {
    const fake = fakeRenderer()
    let current = true
    const controller = new AutoReadingController(
      fake.renderer,
      { mode: 'timed', speed: 30, readingMode: 'page' },
      { claim: async () => ({ accepted: true, isCurrent: () => current }) },
    )
    current = false
    await controller.start()
    expect(controller.getSnapshot().status).toBe('idle')
    controller.dispose()
  })
})

describe('ReaderPlaybackCoordinator', () => {
  it('stops the previous owner and invalidates its claim', async () => {
    const coordinator = new ReaderPlaybackCoordinator()
    const autoStop = vi.fn()
    const ttsStop = vi.fn()
    const unregisterAuto = coordinator.register('auto', autoStop)
    const unregisterTts = coordinator.register('tts', ttsStop)

    const autoClaim = await coordinator.claim('auto')
    const ttsClaim = await coordinator.claim('tts')

    expect(autoStop).toHaveBeenCalledOnce()
    expect(ttsStop).not.toHaveBeenCalled()
    expect(autoClaim.isCurrent()).toBe(false)
    expect(ttsClaim.isCurrent()).toBe(true)

    unregisterAuto()
    unregisterTts()
  })
})
