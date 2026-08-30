import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FootnotePopup } from '../features/reader/components/FootnotePopup'
import type { FootnoteEntry } from '../features/reader/types'

function entry(): FootnoteEntry {
  const view = document.createElement('div')
  view.textContent = '脚注内容'
  return {
    id: 1,
    href: 'chapter-1.xhtml#note-1',
    type: 'footnote',
    hidden: true,
    view,
    anchorRect: { left: 100, top: 120, width: 20, height: 20 },
    canGoBack: false,
  }
}

describe('FootnotePopup', () => {
  it('adopts the temporary view and closes from Escape or the backdrop', () => {
    const onClose = vi.fn()
    const { unmount } = render(<FootnotePopup entry={entry()} onBack={vi.fn()} onClose={onClose} />)

    expect(screen.getByTestId('footnote-popup')).toContainHTML('脚注内容')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getAllByRole('button', { name: '关闭脚注' })[0])
    expect(onClose).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('shows back navigation for nested footnotes', () => {
    const onBack = vi.fn()
    render(<FootnotePopup entry={{ ...entry(), canGoBack: true }} onBack={onBack} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '返回上一个脚注' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
