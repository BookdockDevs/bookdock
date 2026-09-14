import { describe, expect, it } from 'vitest'

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
})
