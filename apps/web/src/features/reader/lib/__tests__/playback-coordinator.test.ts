import { describe, expect, it } from 'vitest'

import { ReaderPlaybackCoordinator } from '../playback-coordinator'

function makeToggle(state: { available: boolean }) {
  let applied = 0
  return {
    applied: () => applied,
    toggle: {
      available: () => state.available,
      apply: () => { applied++ },
    },
  }
}

describe('ReaderPlaybackCoordinator pause/resume toggle', () => {
  it('reports no toggle before any owner has claimed playback', () => {
    const coordinator = new ReaderPlaybackCoordinator()
    const auto = makeToggle({ available: true })
    coordinator.registerToggle('auto', auto.toggle)

    expect(coordinator.canToggle()).toBe(false)
    coordinator.toggle()
    expect(auto.applied()).toBe(0)
  })

  it('toggles the owner that claimed playback', async () => {
    const coordinator = new ReaderPlaybackCoordinator()
    const auto = makeToggle({ available: true })
    const tts = makeToggle({ available: true })
    coordinator.registerToggle('auto', auto.toggle)
    coordinator.registerToggle('tts', tts.toggle)
    await coordinator.claim('tts')

    expect(coordinator.canToggle()).toBe(true)
    coordinator.toggle()
    expect(tts.applied()).toBe(1)
    expect(auto.applied()).toBe(0)
  })

  it('leaves a stopped session inert even though it still owns playback', async () => {
    const coordinator = new ReaderPlaybackCoordinator()
    // owner is never cleared on stop, so a stale owner must not swallow the key
    const auto = makeToggle({ available: false })
    coordinator.registerToggle('auto', auto.toggle)
    await coordinator.claim('auto')

    expect(coordinator.canToggle()).toBe(false)
    coordinator.toggle()
    expect(auto.applied()).toBe(0)
  })

  it('ignores an owner that registered no toggle', async () => {
    const coordinator = new ReaderPlaybackCoordinator()
    await coordinator.claim('tts')

    expect(coordinator.canToggle()).toBe(false)
    expect(() => coordinator.toggle()).not.toThrow()
  })

  it('stops routing to a toggle that unregistered', async () => {
    const coordinator = new ReaderPlaybackCoordinator()
    const auto = makeToggle({ available: true })
    const unregister = coordinator.registerToggle('auto', auto.toggle)
    await coordinator.claim('auto')
    unregister()

    expect(coordinator.canToggle()).toBe(false)
  })

  it('keeps a newer registration when an older one unregisters late', async () => {
    const coordinator = new ReaderPlaybackCoordinator()
    const stale = makeToggle({ available: true })
    const unregisterStale = coordinator.registerToggle('auto', stale.toggle)
    const fresh = makeToggle({ available: true })
    coordinator.registerToggle('auto', fresh.toggle)
    unregisterStale()
    await coordinator.claim('auto')

    coordinator.toggle()
    expect(fresh.applied()).toBe(1)
    expect(stale.applied()).toBe(0)
  })
})
