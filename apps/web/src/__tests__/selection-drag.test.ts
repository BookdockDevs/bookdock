import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SelectionDrag } from '../../public/foliate-js/selection-drag.js'

describe('paginated mouse selection continuation', () => {
  let drag: SelectionDrag
  let text: Text
  let turn: ReturnType<typeof vi.fn>
  let enabled: boolean
  let rtl: boolean
  let visibleStart: number

  function pointer(target: EventTarget, type: string, x = 980, y = 780, pointerType = 'mouse') {
    const event = new Event(type)
    Object.assign(event, { clientX: x, clientY: y, buttons: 1, button: 0, pointerType })
    target.dispatchEvent(event)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1 })
    document.body.textContent = 'abcdefghijklmnop'
    text = document.body.firstChild as Text
    enabled = true
    rtl = false
    visibleStart = 0
    turn = vi.fn(async () => { visibleStart += 3; return true })
    drag = new SelectionDrag({
      enabled: () => enabled,
      rtl: () => rtl,
      bounds: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
      visible: () => {
        const range = document.createRange()
        range.setStart(text, visibleStart)
        range.setEnd(text, visibleStart + 3)
        return range
      },
      turn,
    })
    drag.attach(document)
    document.getSelection()!.setBaseAndExtent(text, 0, text, 2)
  })

  afterEach(() => {
    drag.destroy()
    document.getSelection()?.removeAllRanges()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('dwells, repeats while stationary, and preserves the original anchor', async () => {
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove')
    await vi.advanceTimersByTimeAsync(449)
    expect(turn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(turn).toHaveBeenCalledWith(document, 1)
    expect(document.getSelection()!.anchorOffset).toBe(0)
    expect(document.getSelection()!.toString()).toBe('abcdef')
    await vi.advanceTimersByTimeAsync(1199)
    expect(turn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(turn).toHaveBeenCalledTimes(2)
    expect(document.getSelection()!.toString()).toBe('abcdefghi')
  })

  it('cancels dwell on leaving the corner and re-arms in the opposite corner', async () => {
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove')
    await vi.advanceTimersByTimeAsync(300)
    pointer(document, 'pointermove', 500, 400)
    await vi.advanceTimersByTimeAsync(1000)
    expect(turn).not.toHaveBeenCalled()
    pointer(window, 'pointerup')
    document.getSelection()!.setBaseAndExtent(text, 12, text, 8)
    pointer(document, 'pointerdown', 20, 20)
    pointer(document, 'pointermove', 20, 20)
    await vi.advanceTimersByTimeAsync(450)
    expect(turn).toHaveBeenCalledWith(document, -1)
    expect(document.getSelection()!.anchorOffset).toBe(12)
    expect(document.getSelection()!.focusOffset).toBe(3)
  })

  it('commits an external release and prevents further turns', async () => {
    const commit = vi.fn()
    document.addEventListener('selection-drag-end', commit, { once: true })
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove')
    pointer(window, 'pointerup')
    await vi.advanceTimersByTimeAsync(2000)
    expect(commit).toHaveBeenCalledOnce()
    expect(turn).not.toHaveBeenCalled()
  })

  it('stops repeating at the section boundary', async () => {
    turn.mockResolvedValue(false)
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove')
    await vi.advanceTimersByTimeAsync(3000)
    expect(turn).toHaveBeenCalledOnce()
    expect(document.getSelection()!.toString()).toBe('abc')
  })

  it('does not turn for touch, collapsed selection, or disabled flow', async () => {
    pointer(document, 'pointerdown', 980, 780, 'touch')
    pointer(document, 'pointermove')
    await vi.advanceTimersByTimeAsync(500)
    enabled = false
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove')
    await vi.advanceTimersByTimeAsync(500)
    enabled = true
    document.getSelection()!.collapse(text, 0)
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove')
    await vi.advanceTimersByTimeAsync(500)
    expect(turn).not.toHaveBeenCalled()
  })

  it('maps the lower left corner forward for RTL and cancels on blur', async () => {
    rtl = true
    pointer(document, 'pointerdown', 20, 780)
    pointer(document, 'pointermove', 20, 780)
    await vi.advanceTimersByTimeAsync(450)
    expect(turn).toHaveBeenCalledWith(document, 1)
    window.dispatchEvent(new Event('blur'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(turn).toHaveBeenCalledOnce()
  })

  it('does not resurrect a gesture released during an asynchronous turn', async () => {
    let finish!: (value: boolean) => void
    turn.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove')
    await vi.advanceTimersByTimeAsync(450)
    pointer(window, 'pointerup')
    finish(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(turn).toHaveBeenCalledOnce()
    expect(document.getSelection()!.toString()).toBe('abc')
  })

  it('cancels an armed timer when flow changes or the document detaches', async () => {
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove')
    enabled = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(turn).not.toHaveBeenCalled()
    enabled = true
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove')
    drag.destroy()
    await vi.advanceTimersByTimeAsync(1000)
    expect(turn).not.toHaveBeenCalled()
  })

  it('lets the focus shrink on the new page without changing the anchor', async () => {
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove')
    await vi.advanceTimersByTimeAsync(450)
    const caret = document.createRange()
    caret.setStart(text, 4)
    caret.collapse(true)
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => caret })
    try {
      pointer(document, 'pointermove', 500, 400)
      expect(document.getSelection()!.toString()).toBe('abcd')
      caret.setStart(text, 3)
      caret.collapse(true)
      pointer(document, 'pointermove', 500, 350)
      expect(document.getSelection()!.anchorOffset).toBe(0)
      expect(document.getSelection()!.toString()).toBe('abc')
      await vi.advanceTimersByTimeAsync(1000)
      expect(turn).toHaveBeenCalledOnce()
    } finally {
      Reflect.deleteProperty(document, 'caretRangeFromPoint')
    }
  })

  it('keeps selection alive when parent focus transfers into an iframe', async () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    try {
      pointer(document, 'pointerdown')
      pointer(document, 'pointermove')
      window.dispatchEvent(new Event('blur'))
      await vi.advanceTimersByTimeAsync(450)
      expect(turn).toHaveBeenCalledOnce()
      focus.mockReturnValue(false)
      window.dispatchEvent(new Event('blur'))
      await vi.advanceTimersByTimeAsync(2000)
      expect(turn).toHaveBeenCalledOnce()
    } finally {
      focus.mockRestore()
    }
  })

  it('senses the corner in the margin below the content viewport', async () => {
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove', 1005, 840)
    await vi.advanceTimersByTimeAsync(450)
    expect(turn).toHaveBeenCalledWith(document, 1)
  })

  it('prevents native drag autoscroll only after a text selection starts', () => {
    const before = new MouseEvent('mousemove', { cancelable: true, buttons: 1 })
    document.dispatchEvent(before)
    expect(before.defaultPrevented).toBe(false)
    pointer(document, 'pointerdown')
    pointer(document, 'pointermove')
    const during = new MouseEvent('mousemove', { cancelable: true, buttons: 1 })
    document.dispatchEvent(during)
    expect(during.defaultPrevented).toBe(true)
    pointer(window, 'pointerup')
    const after = new MouseEvent('mousemove', { cancelable: true, buttons: 1 })
    document.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
})
