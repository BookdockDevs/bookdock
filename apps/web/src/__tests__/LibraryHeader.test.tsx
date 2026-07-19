import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LibraryHeader from '../features/library/components/LibraryHeader'
import * as libraryState from '../features/library/state/library-state'

const setSort = vi.fn()
const setView = vi.fn()
const setSearch = vi.fn()
const setFormat = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

vi.mock('../features/library/state/library-state', () => ({
  useLibraryState: vi.fn(),
}))

function mockState() {
  ;(libraryState.useLibraryState as ReturnType<typeof vi.fn>).mockReturnValue({
    view: 'grid',
    setView,
    search: '',
    setSearch,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    setSort,
    format: null,
    setFormat,
  })
}

describe('LibraryHeader', () => {
  it('changes sort via filter panel and calls setSort', () => {
    mockState()
    render(<LibraryHeader onUploadClick={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    fireEvent.click(screen.getByText('书名升序'))
    expect(setSort).toHaveBeenCalledWith('title', 'asc')
  })

  it('changes format via filter panel and calls setFormat', () => {
    mockState()
    render(<LibraryHeader onUploadClick={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    fireEvent.click(screen.getByText('EPUB'))
    expect(setFormat).toHaveBeenCalledWith('epub')
  })

  it('clicks upload button', () => {
    mockState()
    const onUploadClick = vi.fn()
    render(<LibraryHeader onUploadClick={onUploadClick} />)
    screen.getByText('上传').click()
    expect(onUploadClick).toHaveBeenCalled()
  })
})
