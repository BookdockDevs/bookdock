import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import UploadSheet from '../features/library/components/UploadSheet'
import type { UploadItem } from '../features/library/hooks'

function makeItems(overrides: Partial<UploadItem>[]): UploadItem[] {
  return overrides.map((o, i) => ({
    id: `up-${i}`,
    name: `book${i}.epub`,
    file: new File([], `book${i}.epub`),
    status: 'queued' as const,
    progress: 0,
    ...o,
  }))
}

const mockUseUploadBooks = vi.fn()
vi.mock('../features/library/hooks', () => ({
  useUploadBooks: (...args: unknown[]) => mockUseUploadBooks(...args),
}))

describe('UploadSheet', () => {
  beforeEach(() => {
    mockUseUploadBooks.mockReturnValue({ items: [], addFiles: vi.fn(), startUpload: vi.fn(), isUploading: false, clearQueue: vi.fn() })
  })

  it('clicking drop zone triggers hidden file input', () => {
    render(<UploadSheet open onClose={vi.fn()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')
    const dropZone = screen.getByText('library.uploadHint').parentElement
    fireEvent.click(dropZone!)
    expect(clickSpy).toHaveBeenCalled()
  })

  it('renders per-file queue status rows', () => {
    mockUseUploadBooks.mockReturnValue({
      items: makeItems([
        { status: 'uploading', progress: 45 },
        { status: 'processing', progress: 100 },
        { status: 'success' },
        { status: 'duplicate' },
        { status: 'error', message: 'boom' },
      ]),
      addFiles: vi.fn(),
      startUpload: vi.fn(),
      isUploading: true,
      clearQueue: vi.fn(),
    })
    render(<UploadSheet open onClose={vi.fn()} />)
    expect(screen.getByText('book0.epub')).toBeTruthy()
    expect(screen.getByText('library.uploading')).toBeTruthy()
    expect(screen.getByText('library.processing')).toBeTruthy()
    expect(screen.getByText('library.uploadDone')).toBeTruthy()
    expect(screen.getByText('library.uploadDuplicate')).toBeTruthy()
    expect(screen.getByText('boom')).toBeTruthy()
    // progress bars for the two in-flight items
    expect(document.querySelectorAll('span[class*="h-1.5"]')).toHaveLength(2)
  })

  it('disables the close button while uploading', () => {
    mockUseUploadBooks.mockReturnValue({
      items: makeItems([{ status: 'uploading', progress: 10 }]),
      addFiles: vi.fn(),
      startUpload: vi.fn(),
      isUploading: true,
      clearQueue: vi.fn(),
    })
    render(<UploadSheet open onClose={vi.fn()} />)
    const cancel = screen.getByText('library.cancel')
    expect((cancel as HTMLButtonElement).disabled).toBe(true)
  })

  it('starts pending uploads only after clicking the upload button', () => {
    const startUpload = vi.fn()
    mockUseUploadBooks.mockReturnValue({
      items: makeItems([{ status: 'pending' }]),
      addFiles: vi.fn(),
      startUpload,
      isUploading: false,
      clearQueue: vi.fn(),
    })
    render(<UploadSheet open onClose={vi.fn()} />)
    expect(screen.getByText('library.uploadPending')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'library.upload' }))
    expect(startUpload).toHaveBeenCalled()
  })

  it('dropped files auto-start while picked files stay pending', () => {
    const addFiles = vi.fn()
    mockUseUploadBooks.mockReturnValue({ items: [], addFiles, startUpload: vi.fn(), isUploading: false, clearQueue: vi.fn() })
    render(<UploadSheet open onClose={vi.fn()} />)
    const dropZone = screen.getByText('library.uploadHint').parentElement!.parentElement!
    const file = new File([], 'book.epub')
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } })
    expect(addFiles).toHaveBeenCalledWith(expect.anything(), { autoStart: true })

    addFiles.mockClear()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    expect(addFiles).toHaveBeenCalledWith(expect.anything())
    expect(addFiles.mock.calls[0][1]).toBeUndefined()
  })

  it('shows a done button once settled, which clears the queue and closes', () => {
    const clearQueue = vi.fn()
    const onClose = vi.fn()
    mockUseUploadBooks.mockReturnValue({
      items: makeItems([{ status: 'success' }, { status: 'duplicate' }]),
      addFiles: vi.fn(),
      startUpload: vi.fn(),
      isUploading: false,
      clearQueue,
    })
    render(<UploadSheet open onClose={onClose} />)
    expect(screen.queryByText('library.cancel')).toBeNull()
    fireEvent.click(screen.getByText('library.done'))
    expect(clearQueue).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
