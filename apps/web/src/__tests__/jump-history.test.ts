import { describe, expect, it } from 'vitest'

import { createJumpHistory } from '../features/reader/jump-history'

describe('createJumpHistory', () => {
  it('starts with both stacks empty', () => {
    const h = createJumpHistory()
    expect(h.canBack()).toBe(false)
    expect(h.canForward()).toBe(false)
    expect(h.back('a')).toBeNull()
    expect(h.forward('a')).toBeNull()
  })

  it('push enables back and clears the forward stack', () => {
    const h = createJumpHistory()
    h.push('a')
    expect(h.back('b')).toBe('a')
    expect(h.canForward()).toBe(true)
    h.push('b')
    expect(h.canBack()).toBe(true)
    expect(h.canForward()).toBe(false)
  })

  it('ignores empty cfi on push', () => {
    const h = createJumpHistory()
    h.push('')
    expect(h.canBack()).toBe(false)
  })

  it('back moves the current position onto the forward stack', () => {
    const h = createJumpHistory()
    h.push('a')
    h.push('b')
    expect(h.back('c')).toBe('b')
    expect(h.canBack()).toBe(true)
    expect(h.canForward()).toBe(true)
  })

  it('forward moves the current position back onto the back stack', () => {
    const h = createJumpHistory()
    h.push('a')
    expect(h.back('b')).toBe('a')
    expect(h.forward('a')).toBe('b')
    expect(h.canBack()).toBe(true)
    expect(h.canForward()).toBe(false)
    expect(h.back('b')).toBe('a')
  })

  it('walks back through consecutive jumps layer by layer', () => {
    const h = createJumpHistory()
    // jump a→b→c→d pushes the origin of each jump
    h.push('a')
    h.push('b')
    h.push('c')
    expect(h.back('d')).toBe('c')
    expect(h.back('c')).toBe('b')
    expect(h.back('b')).toBe('a')
    expect(h.canBack()).toBe(false)
    expect(h.back('a')).toBeNull()
    // and forward retraces the whole way
    expect(h.forward('a')).toBe('b')
    expect(h.forward('b')).toBe('c')
    expect(h.forward('c')).toBe('d')
    expect(h.canForward()).toBe(false)
  })

  it('caps the back stack at the limit, dropping the oldest entries', () => {
    const h = createJumpHistory(50)
    for (let i = 0; i < 60; i++) h.push(`p${i}`)
    let count = 0
    while (h.back('current') !== null) count++
    expect(count).toBe(50)
  })

  it('clear resets both stacks', () => {
    const h = createJumpHistory()
    h.push('a')
    h.back('b')
    h.clear()
    expect(h.canBack()).toBe(false)
    expect(h.canForward()).toBe(false)
  })
})
