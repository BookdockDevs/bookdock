import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Category } from '@bookdock/shared'

import CatalogUploadSheet from '@/features/library/components/CatalogUploadSheet'
import type { UploadItem, UploadTarget } from '@/features/library/hooks'

let target: UploadTarget
const item: UploadItem = { id: 'queued', name: 'sample.txt', file: new File(['sample'], 'sample.txt'), status: 'pending', progress: 0 }
const categories: Category[] = ['root', 'child'].map((id, index) => ({
  id, name: id, libraryId: 'lib', userId: 'owner', parentId: index ? 'root' : null,
  bookCount: 0, subtreeBookCount: 0, pinned: false, hidden: false, sortOrder: index, createdAt: 1, updatedAt: 1,
}))

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('@/features/library/hooks', () => ({ useLibraryCategories: () => ({ data: { data: categories }, isPending: false, isError: false }) }))
vi.mock('@/features/library/components/UploadSheet', () => ({ default: (props: { target: UploadTarget; shelfName?: string }) => {
  target = props.target
  return <span>{props.shelfName}</span>
} }))

describe('catalog upload classification', () => {
  it('inherits the current category without exposing a destination selector', () => {
    render(<CatalogUploadSheet open libraryId="lib" categoryId="child" onClose={vi.fn()} />)
    expect(screen.getByText('root / child')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(target.fields?.(item)).toEqual({ categoryId: 'child' })
  })

  it('follows the entry context and leaves an unclassified upload unclassified', () => {
    const props = { libraryId: 'lib', onClose: vi.fn() }
    const { rerender } = render(<CatalogUploadSheet {...props} open categoryId="root" />)
    expect(target.fields?.(item)).toEqual({ categoryId: 'root' })
    rerender(<CatalogUploadSheet {...props} open categoryId={null} />)
    expect(target.fields?.(item)).toEqual({})
  })

  it('appends a version without exposing or submitting classification', () => {
    render(<CatalogUploadSheet open libraryId="lib" libraryBookId="work" categoryId="child" onClose={vi.fn()} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(target.fields?.(item)).toEqual({ libraryBookId: 'work' })
  })
})
