import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Category } from '@bookdock/shared'

import LibraryContextBar from '@/features/library/components/LibraryContextBar'
import { categoryChoices, categoryPath, sortCategories } from '@/features/library/taxonomy'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

function category(id: string, parentId: string | null, count: number, pinned = false): Category {
  return { id, libraryId: 'lib', userId: 'user', name: id, parentId, sortOrder: 0, pinned, hidden: false, bookCount: count, subtreeBookCount: count, createdAt: 1, updatedAt: 1 }
}

describe('taxonomy navigation', () => {
  it('keeps pinned children and count sorting inside their parent groups', () => {
    const rows = [category('A', null, 2), category('B', null, 3), category('A1', 'A', 10, true), category('B1', 'B', 1)]
    expect(sortCategories(rows, { mode: 'bookCount' }).map((row) => row.id)).toEqual(['B', 'B1', 'A', 'A1'])
    expect(categoryPath(rows, 'A1').map((row) => row.id)).toEqual(['A', 'A1'])
  })

  it('sorts root counts by their visible subtrees while retaining direct counts', () => {
    const rows = [category('A', null, 1), category('B', null, 4), category('A1', 'A', 8)]
    rows[0]!.subtreeBookCount = 9
    const sorted = sortCategories(rows, { mode: 'bookCount' })
    expect(sorted.map((row) => row.id)).toEqual(['A', 'A1', 'B'])
    expect(sorted[0]!.bookCount).toBe(1)
    expect(categoryChoices(rows).map((row) => row.name)).toEqual(['A', 'A / A1', 'B'])
  })

  it('retains malformed historical nodes without cycling through paths', () => {
    const rows = [category('A', 'B', 0), category('B', 'A', 0)]
    expect(sortCategories(rows, undefined)).toHaveLength(2)
    expect(categoryPath(rows, 'A')).toHaveLength(2)
  })

  it('removes one additional condition without exposing category scope on the page', () => {
    const navigate = vi.fn()
    const clear = vi.fn()
    render(<LibraryContextBar search={{ shelf: 'A', tag: 't', q: 'book', author: 'writer' }} navSearch={navigate}
      onClear={clear} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByText('book ×'))
    expect(navigate).toHaveBeenLastCalledWith({ q: undefined })
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByText('t ×')).toBeNull()
    expect(screen.queryByLabelText('library.leaveCategory')).toBeNull()
    fireEvent.click(screen.getByText('library.clearFilters'))
    expect(clear).toHaveBeenCalledOnce()
  })

  it('offers no range switch for child categories or flat private shelves', () => {
    const { rerender } = render(<LibraryContextBar search={{ shelf: 'A1' }} navSearch={vi.fn()}
      onClear={vi.fn()} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText('library.clearFilters')).toBeNull()
    rerender(<LibraryContextBar search={{ shelf: 's' }} navSearch={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText('library.clearFilters')).toBeNull()
  })

  it('does not render a filter row for a tag browsing view', () => {
    const { container } = render(<LibraryContextBar search={{ tag: 't' }} navSearch={vi.fn()} onClear={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
