import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import EmptyFilter from '../features/library/components/EmptyFilter'
import EmptyLibrary from '../features/library/components/EmptyLibrary'

/**
 * Two empty states that look alike and mean opposite things. An empty library
 * is fixed by adding books; an empty result is fixed by widening the view.
 * Showing the upload invitation to someone who filtered down to nothing sends
 * them off to do the wrong thing, so the filtered case is its own component.
 */
describe('empty library states', () => {
  it('invites an upload when the library itself is empty', () => {
    render(<EmptyLibrary canUpload />)

    expect(screen.getByText('library.empty')).toBeInTheDocument()
    expect(screen.getByText('library.emptyHint')).toBeInTheDocument()
  })

  it('does not offer uploading when the reader may not upload', () => {
    render(<EmptyLibrary canUpload={false} />)

    expect(screen.queryByText('library.emptyHint')).toBeNull()
    expect(screen.getByText('library.emptyNoUpload')).toBeInTheDocument()
  })

  it('offers to clear the filter instead of uploading', () => {
    const onClear = vi.fn()
    render(<EmptyFilter onClear={onClear} />)

    expect(screen.getByText('library.emptyFilter')).toBeInTheDocument()
    expect(screen.queryByText('library.empty')).toBeNull()
    expect(screen.queryByText('library.emptyHint')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'library.clearFilters' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
