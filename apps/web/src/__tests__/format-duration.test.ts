import { describe, it, expect, vi } from 'vitest'

import { formatDuration } from '../lib/format-duration'

function makeT() {
  return vi.fn((key: string, options?: Record<string, string | number>) => `${key} ${JSON.stringify(options ?? {})}`)
}

describe('formatDuration', () => {
  it('shows hours and minutes when hours > 0', () => {
    const t = makeT()
    expect(formatDuration(7384, t)).toBe('stats.durationHours {"h":2,"m":3}')
    expect(t).toHaveBeenCalledWith('stats.durationHours', { h: 2, m: 3 })
  })

  it('shows whole hours with zero minutes', () => {
    const t = makeT()
    expect(formatDuration(3600, t)).toBe('stats.durationHours {"h":1,"m":0}')
  })

  it('shows minutes when under an hour', () => {
    const t = makeT()
    expect(formatDuration(600, t)).toBe('stats.durationMinutes {"m":10}')
  })

  it('shows seconds when under a minute', () => {
    const t = makeT()
    expect(formatDuration(45, t)).toBe('stats.durationSeconds {"s":45}')
  })

  it('shows zero seconds for zero input', () => {
    const t = makeT()
    expect(formatDuration(0, t)).toBe('stats.durationSeconds {"s":0}')
  })

  it('truncates sub-second precision and clamps negatives', () => {
    const t = makeT()
    expect(formatDuration(59.9, t)).toBe('stats.durationSeconds {"s":59}')
    expect(formatDuration(-5, t)).toBe('stats.durationSeconds {"s":0}')
  })
})
