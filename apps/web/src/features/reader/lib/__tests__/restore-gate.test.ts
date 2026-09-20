import { describe, expect, it } from 'vitest'

import { createRestoreGate } from '../restore-gate'

describe('createRestoreGate', () => {
  it('starts open so books without saved progress save immediately', () => {
    const gate = createRestoreGate()
    expect(gate.isPending()).toBe(false)
  })

  it('blocks write-back once armed and releases once opened', () => {
    const gate = createRestoreGate()
    gate.arm()
    expect(gate.isPending()).toBe(true)
    gate.open()
    expect(gate.isPending()).toBe(false)
  })

  it('stays open on redundant opens (rendered + user jump both fire)', () => {
    const gate = createRestoreGate()
    gate.open()
    gate.open()
    expect(gate.isPending()).toBe(false)
  })

  it('re-arms for a new book with saved progress after the previous restore settled', () => {
    const gate = createRestoreGate()
    gate.arm()
    gate.open()
    gate.arm()
    expect(gate.isPending()).toBe(true)
  })
})
