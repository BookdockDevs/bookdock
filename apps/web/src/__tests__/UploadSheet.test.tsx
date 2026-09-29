import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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

const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

const mockUseUploadBooks = vi.fn()
const mockUseShelves = vi.fn()
const mockUseTags = vi.fn()
const mockUseUploadSettings = vi.fn()
vi.mock('../features/library/hooks', () => ({
  useUploadBooks: (...args: unknown[]) => mockUseUploadBooks(...args),
  useShelves: (...args: unknown[]) => mockUseShelves(...args),
  useTags: (...args: unknown[]) => mockUseTags(...args),
  useUploadSettings: () => mockUseUploadSettings(),
}))

function uploadOverrides(overrides: Partial<ReturnType<typeof defaultUpload>> = {}) {
  return { ...defaultUpload(), ...overrides }
}

function defaultUpload() {
  return {
    items: [], addFiles: vi.fn(), startUpload: vi.fn(), retry: vi.fn(), retryAll: vi.fn(),
    abortAll: vi.fn(), pruneSettled: vi.fn(), isUploading: false, clearQueue: vi.fn(),
  }
}

function fileDropData(files: File[]) {
  return { dataTransfer: { files, types: ['Files'] } }
}

describe('UploadSheet', () => {
  beforeEach(() => {
    mockUseShelves.mockReturnValue({ data: { data: [] } })
    mockUseTags.mockReturnValue({ data: { data: [] } })
    mockUseUploadBooks.mockReturnValue(defaultUpload())
    mockUseUploadSettings.mockReturnValue({ maxBytes: undefined, normalizeTitle: true })
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

  it('offers cancel-upload while running, and the header X still closes without aborting', () => {
    const clearQueue = vi.fn()
    const abortAll = vi.fn()
    const onClose = vi.fn()
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({ items: makeItems([{ status: 'uploading', progress: 10 }]), isUploading: true, clearQueue, abortAll }),
    )
    render(<UploadSheet open onClose={onClose} />)

    // The X keeps closing while the upload runs: closing is not cancelling.
    // It is named "close" here so the word "cancel" belongs to the footer alone.
    fireEvent.click(screen.getByRole('button', { name: 'library.close' }))
    expect(clearQueue).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
    expect(abortAll).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'library.uploadCancel' }))
    expect(abortAll).toHaveBeenCalled()
  })

  it('renders no footer at all while the queue is empty', () => {
    render(<UploadSheet open onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'library.upload' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'library.uploadCancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'library.done' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'library.startReading' })).toBeNull()
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

  it('enables version extraction on drop only when both versionNameMode and normalizeTitle are active', () => {
    const addFiles = vi.fn()
    mockUseUploadBooks.mockReturnValue(uploadOverrides({ addFiles }))
    render(<UploadSheet open onClose={vi.fn()} versionNameMode />)
    const dropZone = screen.getByText('library.uploadHint').parentElement!.parentElement!
    fireEvent.drop(dropZone, fileDropData([new File([], 'book.epub')]))
    expect(addFiles).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ autoStart: true, versionNameMode: true }))

    addFiles.mockClear()
    cleanup()
    mockUseUploadSettings.mockReturnValue({ maxBytes: undefined, normalizeTitle: false })
    render(<UploadSheet open onClose={vi.fn()} versionNameMode />)
    const newDropZone = screen.getByText('library.uploadHint').parentElement!.parentElement!
    fireEvent.drop(newDropZone, fileDropData([new File([], 'book.epub')]))
    expect(addFiles).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({ versionNameMode: true }))
  })

  it('shows the context note when provided', () => {
    render(<UploadSheet open onClose={vi.fn()} contextNote="joining work" />)
    expect(screen.getByText('joining work')).toBeInTheDocument()
  })

  it('shows context title as tooltip on context note when provided', () => {
    render(<UploadSheet open onClose={vi.fn()} contextNote="版本 2" contextTitle="将作为「某作品」的新版本上传" />)
    const note = screen.getByText('版本 2')
    expect(note).toBeInTheDocument()
    expect(note.parentElement).toHaveAttribute('title', '将作为「某作品」的新版本上传')
  })

  it('reports settled successes once', () => {
    const onUploaded = vi.fn()
    mockUseUploadBooks.mockReturnValue(uploadOverrides({
      items: makeItems([{ status: 'success', bookVersionId: 'v9' }]),
    }))
    const { rerender } = render(<UploadSheet open onClose={vi.fn()} onUploaded={onUploaded} />)
    expect(onUploaded).toHaveBeenCalledWith(['v9'])
    rerender(<UploadSheet open onClose={vi.fn()} onUploaded={onUploaded} />)
    expect(onUploaded).toHaveBeenCalledTimes(1)
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
    fireEvent.click(screen.getByText('library.done'))
    expect(clearQueue).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('offers to read straight away when one book finished', () => {
    const clearQueue = vi.fn()
    const onClose = vi.fn()
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({
        items: makeItems([{ status: 'success', bookVersionId: 'bv-1' }]),
        clearQueue,
      }),
    )
    render(<UploadSheet open onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'library.startReading' }))
    expect(clearQueue).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/books/$id', params: { id: 'bv-1' } })
  })

  it('reads a duplicate too, and offers reading only for a single finished book', () => {
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({ items: makeItems([{ status: 'duplicate', bookVersionId: 'bv-2' }]) }),
    )
    const { unmount } = render(<UploadSheet open onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'library.startReading' })).toBeTruthy()
    unmount()

    // Two books, one of them readable: no single obvious target to open.
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({
        items: makeItems([{ status: 'success', bookVersionId: 'bv-1' }, { status: 'duplicate', bookVersionId: 'bv-2' }]),
      }),
    )
    render(<UploadSheet open onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'library.startReading' })).toBeNull()
  })

  it('keeps done as the action when the finished book is unreadable', () => {
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({ items: makeItems([{ status: 'success' }]) }),
    )
    render(<UploadSheet open onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'library.startReading' })).toBeNull()
    expect(screen.getByRole('button', { name: 'library.done' })).toBeTruthy()
  })

  it('offers retry-all when some rows failed, and done beside it', () => {
    const retryAll = vi.fn()
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({
        items: makeItems([{ status: 'success' }, { status: 'error' }, { status: 'error' }]),
        retryAll,
      }),
    )
    render(<UploadSheet open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'library.uploadRetryAll' }))
    expect(retryAll).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'library.done' })).toBeTruthy()
  })

  it('does not offer retry-all when nothing failed', () => {
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({ items: makeItems([{ status: 'success' }, { status: 'duplicate' }]) }),
    )
    render(<UploadSheet open onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'library.uploadRetryAll' })).toBeNull()
  })

  it('offers upload while files are staged, and no cancel-upload', () => {
    mockUseUploadBooks.mockReturnValue(
      uploadOverrides({ items: makeItems([{ status: 'pending' }]) }),
    )
    render(<UploadSheet open onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'library.upload' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'library.uploadCancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'library.done' })).toBeNull()
  })
})
