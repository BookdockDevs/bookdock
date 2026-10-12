import { beforeEach, describe, expect, it } from 'vitest'

import { computeDropdownPosition, computeFromAnchor } from '../lib/position'

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

describe('computeDropdownPosition', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  })

  it('keeps an end-aligned dropdown attached to the anchor and inside the viewport', () => {
    const position = computeDropdownPosition({ left: 1080, top: 40, width: 36, height: 36 }, 400, 560, 'end')

    expect(position.left).toBe(716)
    expect(position.top).toBe(82)
    expect(position.dir).toBe('down')
  })

  it('honors a custom gap below and above the anchor', () => {
    const below = computeDropdownPosition({ left: 100, top: 40, width: 36, height: 36 }, 380, 520, 'end', 8)

    expect(below.left).toBe(8)
    expect(below.top).toBe(84)
    expect(below.dir).toBe('down')
  })
})
