import { describe, expect, it, vi } from 'vitest'

import { ReaderPlaybackCoordinator } from '../playback-coordinator'

/**
 * Space is resolved in Reader.tsx's window keydown handler: playback first,
 * reading chrome second, never a page turn. The handler itself is a component
 * effect, so these cases drive the same decision the handler makes — canToggle
 * decides consumption, and the fallback is the chrome toggle — which is what
 * keeps space from ever reaching a paging branch.
 */
function pressSpace(coordinator: ReaderPlaybackCoordinator, onChromeToggle: () => void) {
  if (coordinator.canToggle()) coordinator.toggle()
  else onChromeToggle()
}

describe('reader space key resolution', () => {
  function setup(available: boolean) {
    const coordinator = new ReaderPlaybackCoordinator()
    const pause = vi.fn()
    const resume = vi.fn()
    let status: 'running' | 'paused' | 'idle' = 'running'
    coordinator.registerToggle('auto', {
      available: () => status !== 'idle' && available,
      apply: () => (status === 'running' ? pause() : resume()),
    })
    const claimed = coordinator.claim('auto')
    const onChromeToggle = vi.fn()
    return {
      coordinator,
      onChromeToggle,
      pause,
      resume,
      setStatus: (next: 'running' | 'paused' | 'idle') => { status = next },
      claimed,
    }
  }

  it('pauses a running session instead of paging', async () => {
    const ctx = setup(true)
    await ctx.claimed
    pressSpace(ctx.coordinator, ctx.onChromeToggle)
    expect(ctx.pause).toHaveBeenCalledTimes(1)
    expect(ctx.resume).not.toHaveBeenCalled()
    expect(ctx.onChromeToggle).not.toHaveBeenCalled()
  })

  it('resumes a paused session instead of paging', async () => {
    const ctx = setup(true)
    await ctx.claimed
    ctx.setStatus('paused')
    pressSpace(ctx.coordinator, ctx.onChromeToggle)
    expect(ctx.resume).toHaveBeenCalledTimes(1)
    expect(ctx.pause).not.toHaveBeenCalled()
    expect(ctx.onChromeToggle).not.toHaveBeenCalled()
  })

  it('toggles the chrome when no session can be toggled', async () => {
    const ctx = setup(true)
    await ctx.claimed
    ctx.setStatus('idle')
    pressSpace(ctx.coordinator, ctx.onChromeToggle)
    expect(ctx.onChromeToggle).toHaveBeenCalledTimes(1)
    expect(ctx.pause).not.toHaveBeenCalled()
    expect(ctx.resume).not.toHaveBeenCalled()
  })

  it('toggles the chrome before playback has ever started', () => {
    const coordinator = new ReaderPlaybackCoordinator()
    const onChromeToggle = vi.fn()
    pressSpace(coordinator, onChromeToggle)
    expect(onChromeToggle).toHaveBeenCalledTimes(1)
  })

  it('routes a press to the current owner only', async () => {
    const coordinator = new ReaderPlaybackCoordinator()
    const auto = { available: () => true, apply: vi.fn() }
    const tts = { available: () => true, apply: vi.fn() }
    coordinator.registerToggle('auto', auto)
    coordinator.registerToggle('tts', tts)
    await coordinator.claim('tts')
    pressSpace(coordinator, vi.fn())
    expect(tts.apply).toHaveBeenCalledTimes(1)
    expect(auto.apply).not.toHaveBeenCalled()
  })
})
