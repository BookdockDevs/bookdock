import { fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import DescriptionSection from '../features/library/components/book-detail/DescriptionSection'

const longText = '这是一段足够长的简介，用来验证收起状态下只有四行可见。'.repeat(12)

/**
 * jsdom reports zero for both heights, so the clamp never looks like it cuts
 * anything off. A pair of prototype getters stands in for real layout and lets
 * each test decide whether the blurb overflows.
 */
let overflowing = true

describe('description block', () => {
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
  const originalClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => (overflowing ? 220 : 80),
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 88,
    })
  })

  afterEach(() => {
    overflowing = true
  })

  afterAll(() => {
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScroll)
    if (originalClient) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClient)
  })

  it('does not offer to expand when nothing is cut off', () => {
    overflowing = false
    const { container } = render(<DescriptionSection text="短简介" />)
    expect(screen.queryByRole('button', { name: /展开|Expand/ })).toBeNull()
    expect(container.firstElementChild).not.toHaveClass('cursor-pointer')
    // No fade, no overflow cut: a blurb that fits is just a paragraph.
    expect(container.querySelector('.bg-gradient-to-t')).toBeNull()
  })

  it('expands when the clamped block itself is clicked, and collapses from the heading', () => {
    const { container } = render(<DescriptionSection text={longText} />)
    const text = screen.getByText(longText)
    const buttons = () => [...container.querySelectorAll('button')]
    expect(text).toHaveClass('max-h-[5.6875rem]')
    // Collapsed there is no visible control at all, only the heading-row button.
    expect(buttons()).toHaveLength(1)

    // The heading is not part of the click target.
    fireEvent.click(container.querySelector('p')!)
    expect(text).toHaveClass('max-h-[5.6875rem]')

    fireEvent.click(text)
    expect(text).not.toHaveClass('max-h-[5.6875rem]')
    expect(buttons()).toHaveLength(1)

    fireEvent.click(buttons()[0])
    expect(text).toHaveClass('max-h-[5.6875rem]')
  })

  it('treats a click that ends a text selection as selection, not expansion', () => {
    const selection = { toString: () => '选中的文字' } as unknown as Selection
    const spy = vi.spyOn(window, 'getSelection').mockReturnValue(selection)
    render(<DescriptionSection text={longText} />)
    const text = screen.getByText(longText)

    fireEvent.click(text)
    expect(text).toHaveClass('max-h-[5.6875rem]')
    spy.mockRestore()
  })

  it('keeps right-click wired to the field editor', () => {
    const onEdit = vi.fn()
    render(<DescriptionSection text={longText} onEdit={onEdit} />)
    fireEvent.contextMenu(screen.getByText(longText))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
