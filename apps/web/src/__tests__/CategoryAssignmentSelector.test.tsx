import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category } from '@bookdock/shared'

import CategoryAssignmentSelector from '@/features/library/components/CategoryAssignmentSelector'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => ({
    'library.keepCategory': 'Keep category',
    'library.uncategorized': 'Uncategorized',
    'library.existingCategories': 'Existing categories',
    'library.recommendedCategories': 'Recommended categories',
    'library.searchCategoryTemplates': 'Search templates',
    'library.expand': 'Expand',
    'library.collapse': 'Collapse',
    'library.noCategories': 'No categories',
    'library.categoryTemplate.science.name': 'Science and technology',
    'library.categoryTemplate.science.computing': 'Computing',
    'library.categoryTemplate.science.natural': 'Natural science',
  })[key] ?? key,
}))

function category(id: string, name: string, parentId: string | null = null): Category {
  return { id, libraryId: 'lib', userId: 'owner', name, parentId, sortOrder: 0, pinned: false, hidden: false, bookCount: 1, subtreeBookCount: 1, createdAt: 1, updatedAt: 1 }
}

function selectedRadios() {
  return screen.getAllByRole('radio').filter((radio) => (radio as HTMLInputElement).checked)
}

beforeEach(() => vi.clearAllMocks())

describe('CategoryAssignmentSelector', () => {
  it('shows the chosen full path even while recommendations are collapsed', () => {
    render(<CategoryAssignmentSelector categories={[]} categoryId={undefined} categoryTemplateKey="science.computing" allowTemplates onChange={vi.fn()} />)
    expect(screen.getByText('Science and technology / Computing')).toBeInTheDocument()
    expect(screen.getByText('Recommended categories').closest('details')).not.toHaveAttribute('open')
  })

  it('retains the parent heading when searching for a child and displays its short name', () => {
    render(<CategoryAssignmentSelector categories={[]} categoryId={null} categoryTemplateKey={undefined} allowTemplates onChange={vi.fn()} />)
    fireEvent.click(screen.getByText('Recommended categories'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search templates' }), { target: { value: 'Computing' } })

    expect(screen.getByText('Science and technology')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Science and technology', exact: true })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Science and technology / Computing' })).toBeInTheDocument()
    expect(screen.getByText('Computing', { exact: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Science and technology' }))
    expect(screen.queryByRole('radio', { name: 'Science and technology / Computing' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Science and technology' }))
    expect(screen.getByRole('radio', { name: 'Science and technology / Computing' })).toBeInTheDocument()
  })

  it('distinguishes keeping, uncategorized, and choosing an existing category', () => {
    const onChange = vi.fn()
    const onKeep = vi.fn()
    const props = {
      categories: [category('sci', '科学技术')],
      categoryId: undefined,
      categoryTemplateKey: undefined,
      allowTemplates: false,
      allowKeep: true,
      onKeep,
      onChange,
    }
    const { rerender } = render(<CategoryAssignmentSelector {...props} />)

    expect(screen.getByRole('radio', { name: 'Keep category' })).toBeChecked()
    expect(selectedRadios()).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: 'Uncategorized' }))
    expect(onChange).toHaveBeenCalledWith({ categoryId: null })
    rerender(<CategoryAssignmentSelector {...props} categoryId={null} />)
    expect(screen.getByRole('radio', { name: 'Uncategorized' })).toBeChecked()
    expect(selectedRadios()).toHaveLength(1)

    fireEvent.click(screen.getByRole('radio', { name: '科学技术' }))
    expect(onChange).toHaveBeenLastCalledWith({ categoryId: 'sci' })
    rerender(<CategoryAssignmentSelector {...props} categoryId="sci" />)
    expect(screen.getByRole('radio', { name: '科学技术' })).toBeChecked()
    expect(selectedRadios()).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: 'Keep category' }))
    expect(onKeep).toHaveBeenCalledOnce()
  })

  it('expands a recommended root independently from selecting it and exposes child templates', () => {
    const onChange = vi.fn()
    render(<CategoryAssignmentSelector categories={[]} categoryId={null} categoryTemplateKey={undefined} allowTemplates onChange={onChange} />)

    const recommendations = screen.getByText('Recommended categories')
    expect(recommendations.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(recommendations)
    const expandRoot = screen.getByRole('button', { name: 'Expand Science and technology' })
    expect(expandRoot).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expandRoot)

    expect(expandRoot).toHaveAttribute('aria-expanded', 'true')
    expect(onChange).not.toHaveBeenCalled()
    const childChoice = screen.getByRole('radio', { name: 'Science and technology / Computing' })
    fireEvent.click(childChoice)
    expect(onChange).toHaveBeenCalledWith({ categoryTemplateKey: 'science.computing' })
    fireEvent.click(screen.getByRole('radio', { name: 'Science and technology' }))
    expect(onChange).toHaveBeenLastCalledWith({ categoryTemplateKey: 'science' })
  })

  it('shows an existing template root as a heading without duplicating its selectable path', () => {
    render(<CategoryAssignmentSelector categories={[category('sci', '科学技术')]} categoryId="sci" categoryTemplateKey={undefined} allowTemplates onChange={vi.fn()} />)
    fireEvent.click(screen.getByText('Recommended categories'))

    const expandRoot = screen.getByRole('button', { name: 'Expand Science and technology' })
    fireEvent.click(expandRoot)
    expect(screen.getAllByRole('radio', { name: '科学技术' })).toHaveLength(1)
    expect(screen.getByRole('radio', { name: 'Science and technology / Computing' })).toBeInTheDocument()
  })

  it('names radio groups independently when multiple selectors are mounted', () => {
    render(
      <div>
        <section aria-label="First selector"><CategoryAssignmentSelector categories={[]} categoryId={null} categoryTemplateKey={undefined} allowTemplates={false} onChange={vi.fn()} /></section>
        <section aria-label="Second selector"><CategoryAssignmentSelector categories={[]} categoryId={null} categoryTemplateKey={undefined} allowTemplates={false} onChange={vi.fn()} /></section>
      </div>,
    )

    const first = within(screen.getByRole('region', { name: 'First selector' })).getByRole('radio', { name: 'Uncategorized' })
    const second = within(screen.getByRole('region', { name: 'Second selector' })).getByRole('radio', { name: 'Uncategorized' })
    expect(first).toBeChecked()
    expect(second).toBeChecked()
    expect(first).toHaveAttribute('name')
    expect(first.getAttribute('name')).not.toBe(second.getAttribute('name'))
  })
})
