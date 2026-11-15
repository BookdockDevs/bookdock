import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ClientCategoryView } from '@bookdock/shared'
import { CATEGORY_TEMPLATES, categoryTemplatePath } from '@bookdock/shared'

import CategoryAssignmentSelector from '@/features/library/components/CategoryAssignmentSelector'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => ({
    'library.keepCategory': 'Keep category',
    'library.uncategorized': 'Uncategorized',
    'library.categoryName': 'Category name',
    'library.apply': 'Apply',
    'library.recommendedCategories': 'Recommended categories',
  })[key] ?? key,
}))

const categories: ClientCategoryView[] = [{
  id: '["Fiction","Mystery"]', libraryId: 'lib', name: 'Mystery', parentId: '["Fiction"]',
  path: ['Fiction', 'Mystery'], pinned: false, hidden: false, bookCount: 1, subtreeBookCount: 1,
  sortOrder: 0, createdAt: 1, updatedAt: 1,
}]

describe('CategoryAssignmentSelector', () => {
  it('selects an existing category path', () => {
    const onChange = vi.fn()
    render(<CategoryAssignmentSelector categories={categories} categoryPath={null} allowTemplates={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Fiction / Mystery' }))
    expect(onChange).toHaveBeenCalledWith({ categoryPath: ['Fiction', 'Mystery'] })
  })

  it('keeps unchanged, uncategorized and a chosen existing path distinct', () => {
    const onChange = vi.fn()
    const onKeep = vi.fn()
    const props = { categories, categoryPath: undefined as string[] | null | undefined, allowTemplates: false, allowKeep: true, onKeep, onChange }
    const { rerender } = render(<CategoryAssignmentSelector {...props} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Fiction / Mystery' }))
    expect(onChange).toHaveBeenCalledWith({ categoryPath: ['Fiction', 'Mystery'] })
    rerender(<CategoryAssignmentSelector {...props} categoryPath={null} />)
    expect(screen.getByRole('radio', { name: 'Uncategorized' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Keep category' }))
    expect(onKeep).toHaveBeenCalledOnce()
  })

  it('applies a recommended path without creating a taxonomy entity', () => {
    const onChange = vi.fn()
    render(<CategoryAssignmentSelector categories={[]} categoryPath={null} allowTemplates onChange={onChange} />)
    fireEvent.click(screen.getByText('Recommended categories'))
    const lastTemplate = CATEGORY_TEMPLATES.flatMap((group) => [group, ...(group.children ?? [])]).at(-1)!
    const expected = categoryTemplatePath(lastTemplate.key)!
    fireEvent.click(screen.getAllByRole('button', { name: /library.expand/ }).at(-1)!)
    fireEvent.click(screen.getAllByRole('radio').at(-1)!)
    expect(onChange).toHaveBeenCalledWith({ categoryPath: expected })
  })

  it('keeps the selected path label explicit when several selectors are mounted', () => {
    render(<div><section aria-label="First"><CategoryAssignmentSelector categories={categories} categoryPath={null} allowTemplates={false} onChange={vi.fn()} /></section><section aria-label="Second"><CategoryAssignmentSelector categories={categories} categoryPath={null} allowTemplates={false} onChange={vi.fn()} /></section></div>)
    expect(within(screen.getByRole('region', { name: 'First' })).getByRole('radio', { name: 'Uncategorized' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Second' })).getByRole('radio', { name: 'Uncategorized' })).toBeInTheDocument()
  })
})
