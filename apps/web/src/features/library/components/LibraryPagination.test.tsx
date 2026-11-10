import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import BookGrid from './BookGrid'
import LibraryPagination from './LibraryPagination'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, unknown>) => {
    if (key === 'library.pageNumber') return `Page ${params?.page}`
    return key
  },
}))

describe('LibraryPagination prefetching', () => {
  it('prefetches adjacent, numbered, and ellipsis-jump pages on hover and focus without prefetching the current page', () => {
    const onPageChange = vi.fn()
    const onPrefetchPage = vi.fn()

    render(
      <LibraryPagination
        currentPage={5}
        totalPages={10}
        totalBooks={240}
        onPageChange={onPageChange}
        onPrefetchPage={onPrefetchPage}
      />,
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Page 5' }))
    expect(onPrefetchPage).not.toHaveBeenCalled()

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'library.nextPage' }))
    expect(onPrefetchPage).toHaveBeenLastCalledWith(6)

    fireEvent.focus(screen.getByRole('button', { name: 'library.previousPage' }))
    expect(onPrefetchPage).toHaveBeenLastCalledWith(4)

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Page 10' }))
    expect(onPrefetchPage).toHaveBeenLastCalledWith(10)

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'library.jumpForward' }))
    expect(onPrefetchPage).toHaveBeenLastCalledWith(10)

    fireEvent.focus(screen.getByRole('button', { name: 'library.jumpBackward' }))
    expect(onPrefetchPage).toHaveBeenLastCalledWith(1)
  })

  it('skips prefetching when disabled', () => {
    const onPrefetchPage = vi.fn()

    render(
      <LibraryPagination
        currentPage={2}
        totalPages={5}
        totalBooks={120}
        disabled
        onPageChange={vi.fn()}
        onPrefetchPage={onPrefetchPage}
      />,
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Page 3' }))
    expect(onPrefetchPage).not.toHaveBeenCalled()
  })
})

describe('BookGrid page transitions', () => {
  it('applies the fade-in animation class and transitioning state when fetching placeholder pages', () => {
    const { container, rerender } = render(
      <BookGrid pageKey={1} view="grid" columns={4} isTransitioning>
        <div>Book 1</div>
      </BookGrid>,
    )

    const grid = container.firstElementChild as HTMLElement
    expect(grid.className).toContain('animate-page-fade-in')
    expect(grid.className).toContain('opacity-55')
    expect(grid.className).toContain('pointer-events-none')
    expect(grid.getAttribute('aria-busy')).toBe('true')

    rerender(
      <BookGrid pageKey={2} view="grid" columns={4} isTransitioning={false}>
        <div>Book 2</div>
      </BookGrid>,
    )

    const settledGrid = container.firstElementChild as HTMLElement
    expect(settledGrid).not.toBe(grid)
    expect(settledGrid.className).toContain('animate-page-fade-in')
    expect(settledGrid.className).not.toContain('opacity-55')
    expect(settledGrid.getAttribute('aria-busy')).toBeNull()
  })
})
