import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { ReaderHeader } from '../features/reader/components/ReaderHeader'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}))

describe('ReaderHeader', () => {
  it('renders bookmark icon filled when bookmark is active', () => {
    render(
      <ReaderHeader
        title="测试书籍"
        visible
        bookmarkActive
        onAddBookmark={vi.fn()}
        onToggleSettings={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    const bookmarkButton = screen.getByTitle('添加书签')
    expect(bookmarkButton).toHaveClass('border-current', 'text-current')
    const svg = bookmarkButton.querySelector('svg')
    expect(svg).toHaveAttribute('fill', 'currentColor')
  })

  it('renders bookmark icon outlined when bookmark is inactive', () => {
    render(
      <ReaderHeader
        title="测试书籍"
        visible
        bookmarkActive={false}
        onAddBookmark={vi.fn()}
        onToggleSettings={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    const bookmarkButton = screen.getByTitle('添加书签')
    expect(bookmarkButton).toHaveClass('border-[var(--bd-read-accent)]')
    const svg = bookmarkButton.querySelector('svg')
    expect(svg).toHaveAttribute('fill', 'none')
  })
})
