import { describe, expect, it, vi } from 'vitest'

// @ts-expect-error plain vendored ESM without type declarations
import { Overlayer } from '../../public/foliate-js/overlayer.js'

const rects = [
  { left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 },
  { left: 10, top: 45, right: 90, bottom: 65, width: 80, height: 20 },
]

describe('foliate overlayer compatibility', () => {
  it('keeps rounded multi-line highlights from the overlayer baseline', () => {
    const group = Overlayer.highlight(rects)

    expect(group.childElementCount).toBe(2)
    expect(group.firstElementChild?.tagName.toLowerCase()).toBe('path')
    expect(group.style.opacity).toBe('var(--overlayer-highlight-opacity, .3)')
  })

  it('preserves Bookdock idea annotations as dashed underlines', () => {
    const group = Overlayer.dashedUnderline(rects, { color: 'purple' })

    expect(group.getAttribute('stroke')).toBe('purple')
    expect(group.getAttribute('stroke-dasharray')).toBe('4 3')
    expect(group.childElementCount).toBe(2)
  })

  it('repaints ranges after the iframe first paint', () => {
    const text = document.createTextNode('annotation')
    document.body.append(text)
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, text.length)

    let width = 0
    Object.defineProperty(range, 'getClientRects', {
      configurable: true,
      value: () => [{ left: 10, top: 20, right: 10 + width, bottom: 40, width, height: 20 }],
    })
    let frame: FrameRequestCallback | undefined
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')
      .mockImplementation(callback => {
        frame = callback
        return 1
      })
    const overlayer = new Overlayer(document)

    overlayer.add('annotation', range, Overlayer.underline)
    expect(overlayer.element.querySelector('rect')?.getAttribute('width')).toBe('0')

    width = 100
    frame?.(16)
    expect(overlayer.element.querySelector('rect')?.getAttribute('width')).toBe('100')

    requestAnimationFrame.mockRestore()
    text.remove()
  })
})
