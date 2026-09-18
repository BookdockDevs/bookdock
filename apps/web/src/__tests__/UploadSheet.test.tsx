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
const mockUseShelves = vi.fn()
const mockUseTags = vi.fn()
vi.mock('../features/library/hooks', () => ({
  useUploadBooks: (...args: unknown[]) => mockUseUploadBooks(...args),
  useShelves: (...args: unknown[]) => mockUseShelves(...args),
  useTags: (...args: unknown[]) => mockUseTags(...args),
  useUploadSettings: () => ({ maxBytes: undefined }),
}))

function uploadOverrides(overrides: Partial<ReturnType<typeof defaultUpload>> = {}) {
  return { ...defaultUpload(), ...overrides }
}

function defaultUpload() {
  return { items: [], addFiles: vi.fn(), startUpload: vi.fn(), retry: vi.fn(), pruneSettled: vi.fn(), isUploading: false, clearQueue: vi.fn() }
}

function fileDropData(files: File[]) {
  return { dataTransfer: { files, types: ['Files'] } }
}

describe('UploadSheet', () => {
  beforeEach(() => {
    mockUseShelves.mockReturnValue({ data: { data: [] } })
    mockUseTags.mockReturnValue({ data: { data: [] } })
    mockUseUploadBooks.mockReturnValue(defaultUpload())
  })

  it('clicking drop zone triggers hidden file input', () => {
    render(<UploadSheet open onClose={vi.fn()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')
    const dropZone = screen.getByText('library.uploadHint').parentElement
    fireEvent.click(dropZone!)
    expect(clickSpy).toHaveBeenCalled()
  })

  it('prunes settled rows from a previous upload when the sheet opens', () => {
    const pruneSettled = vi.fn()
    const { rerender } = render(<UploadSheet open={false} onClose={vi.fn()} />)
    mockUseUploadBooks.mockReturnValue(uploadOverrides({ pruneSettled }))
    rerender(<UploadSheet open onClose={vi.fn()} />)
    expect(pruneSettled).toHaveBeenCalled()
  })

  it('renders per-file queue status rows', () => {
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({
        items: makeItems([
          { status: 'uploading', progress: 45 },
          { status: 'processing', progress: 100 },
          { status: 'success' },
          { status: 'duplicate' },
          { status: 'error', messageKey: 'errors.uploadTooLarge' },
        ]),
        isUploading: true,
      }),
    )
    render(<UploadSheet open onClose={vi.fn()} />)
    expect(screen.getByText('book0.epub')).toBeTruthy()
    expect(screen.getByText('library.uploading')).toBeTruthy()
    expect(screen.getByText('library.processing')).toBeTruthy()
    expect(screen.getByText('library.uploadDone')).toBeTruthy()
    expect(screen.getByText('library.uploadDuplicate')).toBeTruthy()
    // error rows render the i18n key resolved client-side, not the raw server message
    expect(screen.getByText('errors.uploadTooLarge')).toBeTruthy()
    // progress bars for the two in-flight items
    expect(document.querySelectorAll('span[class*="h-1.5"]')).toHaveLength(2)
  })

  it('keeps the close button enabled while uploading (closing stays resumable)', () => {
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({ items: makeItems([{ status: 'uploading', progress: 10 }]), isUploading: true }),
    )
    render(<UploadSheet open onClose={vi.fn()} />)
    const cancel = screen.getByText('library.cancel')
    expect((cancel as HTMLButtonElement).disabled).toBe(false)
  })

  it('starts pending uploads only after clicking the upload button', () => {
    const startUpload = vi.fn()
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({ items: makeItems([{ status: 'pending' }]), startUpload }),
    )
    render(<UploadSheet open onClose={vi.fn()} />)
    expect(screen.getByText('library.uploadPending')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'library.upload' }))
    expect(startUpload).toHaveBeenCalled()
  })

  it('dropped files auto-start while picked files stay pending', () => {
    const addFiles = vi.fn()
    mockUseUploadBooks.mockReturnValue(uploadOverrides({ addFiles }))
    render(<UploadSheet open onClose={vi.fn()} />)
    const dropZone = screen.getByText('library.uploadHint').parentElement!.parentElement!
    const file = new File([], 'book.epub')
    fireEvent.drop(dropZone, fileDropData([file]))
    expect(addFiles).toHaveBeenCalledTimes(1)
    expect(addFiles).toHaveBeenCalledWith(expect.anything(), { autoStart: true, maxBytes: undefined, shelfId: undefined, tagIds: [] })

    addFiles.mockClear()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    expect(addFiles).toHaveBeenCalledWith(expect.anything(), { maxBytes: undefined, shelfId: undefined, tagIds: [] })
  })

  it('accepts file drops on the sheet panel outside the dashed dropzone', () => {
    const addFiles = vi.fn()
    mockUseUploadBooks.mockReturnValue(uploadOverrides({ addFiles }))
    render(<UploadSheet open onClose={vi.fn()} />)
    // the panel wraps the title; dropping on the title area must not lose files
    const panel = screen.getByRole('heading', { name: 'library.upload' }).parentElement!
    fireEvent.drop(panel, fileDropData([new File([], 'book.epub')]))
    expect(addFiles).toHaveBeenCalledTimes(1)
    expect(addFiles).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ autoStart: true }))
  })

  it('shows the not-moved note on a duplicate whose requested shelf differs', () => {
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({
        items: makeItems([{ status: 'duplicate', shelfId: 'shelf-2', messageKey: 'library.uploadDuplicateNotMoved' }]),
      }),
    )
    render(<UploadSheet open onClose={vi.fn()} />)
    expect(screen.getByText('library.uploadDuplicateNotMoved')).toBeTruthy()
    expect(screen.queryByText('library.uploadDuplicate')).toBeNull()
  })

  it('retries an errored item', () => {
    const retry = vi.fn()
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({ items: makeItems([{ status: 'error', messageKey: 'library.uploadFailed' }]), retry }),
    )
    render(<UploadSheet open onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('library.uploadRetry'))
    expect(retry).toHaveBeenCalledWith('up-0')
  })

  it('shows the current shelf and keeps the current tag opt-in', () => {
    const addFiles = vi.fn()
    mockUseShelves.mockReturnValue({ data: { data: [{ id: 'shelf-1', name: '科幻' }] } })
    mockUseTags.mockReturnValue({ data: { data: [{ id: 'tag-1', name: '待读' }] } })
    mockUseUploadBooks.mockReturnValue(uploadOverrides({ addFiles }))

    render(<UploadSheet open onClose={vi.fn()} shelfId="shelf-1" tagId="tag-1" />)

    expect(screen.getByText('library.uploadShelfContext')).toBeInTheDocument()
    const tagCheckbox = screen.getByRole('checkbox', { name: 'library.uploadTagContext' })
    expect(tagCheckbox).not.toBeChecked()
    fireEvent.click(tagCheckbox)

    const dropZone = screen.getByText('library.uploadHint').parentElement!.parentElement!
    const file = new File([], 'book.epub')
    fireEvent.drop(dropZone, fileDropData([file]))
    expect(addFiles).toHaveBeenCalledWith(expect.anything(), { autoStart: true, maxBytes: undefined, shelfId: 'shelf-1', tagIds: ['tag-1'] })
  })

  it('shows a done button once settled, which clears the queue and closes', () => {
    const clearQueue = vi.fn()
    const onClose = vi.fn()
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({ items: makeItems([{ status: 'success' }, { status: 'duplicate' }]), clearQueue }),
    )
    render(<UploadSheet open onClose={onClose} />)
    expect(screen.queryByText('library.cancel')).toBeNull()
    fireEvent.click(screen.getByText('library.done'))
    expect(clearQueue).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
