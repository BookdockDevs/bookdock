import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LibraryHeader from '../features/library/components/LibraryHeader'

const navSearch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

function renderHeader(overrides = {}) {
  return render(
    <LibraryHeader
      navSearch={navSearch}
      view="grid"
      query=""
      sortBy="createdAt"
      sortOrder="desc"
      format={null}
      readStatus={null}
      onUploadClick={vi.fn()}
      {...overrides}
    />,
  )
}

describe('LibraryHeader', () => {
  it('debounces search input before calling navSearch', async () => {
    renderHeader()
    fireEvent.change(screen.getByPlaceholderText('library.searchPlaceholder'), { target: { value: 'dune' } })
    expect(navSearch).not.toHaveBeenCalled()
    await waitFor(() => expect(navSearch).toHaveBeenCalledWith({ q: 'dune' }))
  })

  it('reflects external query changes in the input', () => {
    const { rerender } = renderHeader()
    rerender(
      <LibraryHeader
        navSearch={navSearch}
        view="grid"
        query="dune"
        sortBy="createdAt"
        sortOrder="desc"
        format={null}
        readStatus={null}
        onUploadClick={vi.fn()}
      />,
    )
    expect(screen.getByPlaceholderText('library.searchPlaceholder')).toHaveValue('dune')
  })

  it('clicks upload button', () => {
    const onUploadClick = vi.fn()
    renderHeader({ onUploadClick })
    screen.getByText('library.upload').click()
    expect(onUploadClick).toHaveBeenCalled()
  })

  it('toggles select mode via button', () => {
    const onToggleSelectMode = vi.fn()
    renderHeader({ onToggleSelectMode })
    screen.getByRole('button', { name: 'library.selectMode' }).click()
    expect(onToggleSelectMode).toHaveBeenCalled()
  })

  it('reflects selection state via aria-pressed', () => {
    renderHeader({ selectionActive: true, onToggleSelectMode: vi.fn() })
    expect(screen.getByRole('button', { name: 'library.selectMode' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('trash mode hides library search/filter controls but keeps select mode', () => {
    renderHeader({ trash: true, trashCount: 3, onToggleSelectMode: vi.fn(), onEmptyTrash: vi.fn() })
    expect(screen.queryByPlaceholderText('library.searchPlaceholder')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'library.selectMode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'library.emptyTrash' })).toBeInTheDocument()
  })
})
