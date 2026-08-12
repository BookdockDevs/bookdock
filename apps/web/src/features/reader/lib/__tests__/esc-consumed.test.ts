import { describe, expect, it, vi, beforeEach } from 'vitest'

import { consumeEscFlag, markEscConsumed } from '../esc-consumed'

describe('esc-consumed flag', () => {
  beforeEach(() => {
    consumeEscFlag()
  })

  it('returns false when nothing marked the flag', () => {
    expect(consumeEscFlag()).toBe(false)
  })

  it('returns true once after a mark, then resets', () => {
    markEscConsumed()
    expect(consumeEscFlag()).toBe(true)
    expect(consumeEscFlag()).toBe(false)
  })

  it('re-dispatched Escape on a deep element reaches window and document listeners', () => {
    // Regression for the iframe Esc bridge: dispatching a synthetic keydown on
    // `document` directly never reaches window-level listeners (the event path
    // is built from the parentNode chain, which stops at the document).
    const windowHits: string[] = []
    const docHits: string[] = []
    window.addEventListener('keydown', (e) => windowHits.push(e.key))
    document.addEventListener('keydown', (e) => docHits.push(e.key))

    const host = document.body
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(windowHits).toEqual(['Escape'])
    expect(docHits).toEqual(['Escape'])
  })

  it('deferred reader handler skips exit when a popup consumed the Esc', () => {
    const navigate = vi.fn()
    const escKey = new KeyboardEvent('keydown', { key: 'Escape' })

    const popupListener = () => {
      // A popup listener registered after the reader's own handler marks the
      // flag synchronously on the same event dispatch.
      markEscConsumed()
    }
    window.addEventListener('keydown', popupListener)

    // Mirror the Reader handler: defer, then consult the flag.
    const onKey = () => {
      setTimeout(() => {
        if (consumeEscFlag()) return
        navigate()
      }, 0)
    }
    window.addEventListener('keydown', onKey)
    window.dispatchEvent(escKey)

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(navigate).not.toHaveBeenCalled()
        window.removeEventListener('keydown', onKey)
        window.removeEventListener('keydown', popupListener)
        resolve()
      }, 10)
    })
  })

  it('deferred reader handler exits when no popup consumed the Esc', () => {
    const navigate = vi.fn()
    const escKey = new KeyboardEvent('keydown', { key: 'Escape' })

    const onKey = () => {
      setTimeout(() => {
        if (consumeEscFlag()) return
        navigate()
      }, 0)
    }
    window.addEventListener('keydown', onKey)
    window.dispatchEvent(escKey)

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(navigate).toHaveBeenCalledTimes(1)
        window.removeEventListener('keydown', onKey)
        resolve()
      }, 10)
    })
  })
})
