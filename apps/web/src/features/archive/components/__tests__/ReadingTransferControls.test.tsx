import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiDelete, apiGet, apiPost } from '@/api/client'
import ReadingTransferControls from '../ReadingTransferControls'

vi.mock('@/api/client', () => ({
  ApiError: class extends Error {},
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}))

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, unknown>) => {
    if (options?.archives !== undefined) {
      return `preview: ${options.archives} archives, ${options.sessions} sessions`
    }
    return key
  },
}))

describe('ReadingTransferControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    window.URL.revokeObjectURL = vi.fn()
  })

  it('renders JSON export, CSV export, and restore actions in global mode', () => {
    render(<ReadingTransferControls />)

    expect(screen.getByText('readingData.exportJsonTitle')).toBeInTheDocument()
    expect(screen.getByText('readingData.exportCsvTitle')).toBeInTheDocument()
    expect(screen.getByText('readingData.importJsonTitle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /JSON/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /CSV/i })).toBeInTheDocument()
    expect(screen.getByText('readingData.importAction')).toBeInTheDocument()
    expect(screen.queryByText('readingData.deleteArchive')).not.toBeInTheDocument()
  })

  it('renders book-specific titles and delete archive action in single book mode', () => {
    render(<ReadingTransferControls bookId="b1" />)

    expect(screen.getByText('readingData.bookExportJsonTitle')).toBeInTheDocument()
    expect(screen.getByText('readingData.bookExportCsvTitle')).toBeInTheDocument()
    expect(screen.getByText('readingData.deleteArchive')).toBeInTheDocument()
  })

  it('confirms and calls apiDelete when deleting book archive', async () => {
    vi.mocked(apiDelete).mockResolvedValueOnce({ success: true })
    const onDelete = vi.fn()
    render(<ReadingTransferControls bookId="b1" onDeleteArchive={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'readingData.deleteArchive' }))
    expect(screen.getByText('readingData.deleteArchiveConfirm')).toBeInTheDocument()

    // Confirm modal action button has label 'reader.sessionDelete'
    const confirmButtons = screen.getAllByRole('button', { name: 'reader.sessionDelete' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith('/reading-records/book/b1/ledger')
      expect(onDelete).toHaveBeenCalled()
    })
  })

  it('exports JSON on button click', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({
      data: {
        version: 1,
        exportedAt: 1234567890,
        archives: [],
      },
    })

    render(<ReadingTransferControls />)
    const jsonBtn = screen.getByRole('button', { name: /JSON/i })
    fireEvent.click(jsonBtn)

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/reading-records/transfer')
    })
  })

  it('keeps deletion failures inside the confirmation dialog and allows retry', async () => {
    vi.mocked(apiDelete).mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({})
    const onDelete = vi.fn()
    render(<ReadingTransferControls bookId="b1" onDeleteArchive={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.deleteArchive' }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'reader.sessionDelete' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('reader.sessionActionFailed')
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'reader.sessionDelete' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce())
  })

  it('previews import when valid json file is selected', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({
      data: {
        archives: 2,
        sessions: 10,
        duplicates: 1,
      },
    })

    render(<ReadingTransferControls />)
    const file = new File(
      [
        JSON.stringify({
          version: 1,
          exportedAt: 1234567890,
          archives: [],
        }),
      ],
      'backup.json',
      { type: 'application/json' },
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeInTheDocument()

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/reading-records/transfer/preview', expect.any(Object))
      expect(screen.getByText(/preview: 2 archives, 10 sessions/i)).toBeInTheDocument()
    })
    const dialog = screen.getByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'readingData.importConfirm' })
    expect(confirm).toHaveClass('bg-stone-900')
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('failed'))
    fireEvent.click(confirm)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('reader.sessionActionFailed')
  })
})
