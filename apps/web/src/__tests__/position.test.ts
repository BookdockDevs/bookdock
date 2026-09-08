import { beforeEach, describe, expect, it } from 'vitest'

import { computeFromAnchor } from '../lib/position'

describe('computeFromAnchor', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  })

  it('aligns a menu to the anchor edge when it opens to the left', () => {
    const position = computeFromAnchor({ left: 260, top: 100, width: 28, height: 28 }, 176, 88)

    expect(position.left).toBe(112)
    expect(position.top).toBe(136)
    expect(position.dir).toBe('down')
  })
})
