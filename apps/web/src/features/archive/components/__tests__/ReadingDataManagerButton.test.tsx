import { fireEvent, render as renderUi, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiDelete, apiGet } from '@/api/client'
import ReadingDataManagerButton from '../ReadingDataManagerButton'

vi.mock('@/api/client', () => ({
  ApiError: class extends Error {},
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

vi.mock('../ReadingImportDialog', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mock-import-dialog">
      <button type="button" onClick={onClose} data-testid="mock-import-close">
        Close
      </button>
    </div>
  ),
}))

vi.mock('../ImportLocatorDialog', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mock-locator-dialog">
      <button type="button" onClick={onClose} data-testid="mock-locator-close">
        Close Locator
      </button>
    </div>
  ),
}))

function render(children: ReactNode) {
  return renderUi(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>)
}

describe('ReadingDataManagerButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    window.URL.revokeObjectURL = vi.fn()
  })

  it('renders global 2 tabs: import and export', () => {
    render(<ReadingDataManagerButton />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'readingData.tabImport' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'readingData.tabExport' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'readingData.tabManage' })).toBeNull()

    // Import is active by default
    expect(screen.getByTestId('mock-import-dialog')).toBeInTheDocument()

    // Switch to Export tab
    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabExport' }))
    expect(screen.getByRole('radio', { name: /readingData.scopeAll/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /readingData.scopeTime/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /readingData.scopeNotes/ })).toBeInTheDocument()
  })

  it('renders 3 tabs in single book mode and supports manage tab with locator and scoped delete', async () => {
    vi.mocked(apiDelete).mockResolvedValue({ data: { ok: true, remaining: false } })
    const onBookDeleted = vi.fn()
    render(<ReadingDataManagerButton bookId="book-123" bookTitle="My Book" onBookDeleted={onBookDeleted} />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))

    expect(screen.getByRole('tab', { name: 'readingData.tabManage' })).toBeInTheDocument()

    // Switch to Manage tab
    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabManage' }))
    expect(screen.getByText('readingImport.locatorTitle')).toBeInTheDocument()
    expect(screen.getByText('readingData.deleteArchive')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'readingData.scopeAll' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'readingData.scopeTime' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'readingData.scopeNotes' })).not.toBeChecked()

    // Open locator
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.locatorAction' }))
    expect(screen.getByTestId('mock-locator-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mock-locator-close'))

    // Switch to time scope and confirm deletion when notes remain
    vi.mocked(apiDelete).mockResolvedValueOnce({ data: { ok: true, remaining: true } })
    fireEvent.click(screen.getByRole('radio', { name: 'readingData.scopeTime' }))
    fireEvent.click(screen.getByRole('button', { name: 'readingData.deleteTimeAction' }))
    const timeAlert = screen.getByRole('alertdialog')
    fireEvent.click(within(timeAlert).getByRole('button', { name: 'readingData.deleteTimeAction' }))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/archive/books/book-123?scope=time'))
    expect(onBookDeleted).not.toHaveBeenCalled()

    // Reopen, select notes scope, and confirm when archive becomes empty
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))
    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabManage' }))
    fireEvent.click(screen.getByRole('radio', { name: 'readingData.scopeNotes' }))
    fireEvent.click(screen.getByRole('button', { name: 'readingData.deleteNotesAction' }))
    const notesAlert = screen.getByRole('alertdialog')
    fireEvent.click(within(notesAlert).getByRole('button', { name: 'readingData.deleteNotesAction' }))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/archive/books/book-123?scope=notes'))
    expect(onBookDeleted).toHaveBeenCalledTimes(1)
  })

  it('exports json data from export tab', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({
      data: { version: 1, kind: 'bookdock-data-export', scope: 'all', exportedAt: 1 },
    })
    render(<ReadingDataManagerButton />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))

    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabExport' }))
    await fireEvent.click(screen.getByRole('button', { name: /readingData.exportAllArchives/ }))

    expect(apiGet).toHaveBeenCalledWith('/archive/data-export?scope=all')
  })

  it('exports time scope as CSV from export tab', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({
      data: { version: 1, kind: 'bookdock-data-export', scope: 'time', exportedAt: 1, durationFacts: [] },
    })
    let capturedBlob: Blob | null = null
    window.URL.createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob
      return 'blob:mock-url'
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<ReadingDataManagerButton />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))

    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabExport' }))
    fireEvent.click(screen.getByRole('radio', { name: 'readingData.scopeTime' }))
    fireEvent.click(screen.getByRole('radio', { name: 'annotation.exportCsv' }))
    fireEvent.click(screen.getByRole('button', { name: /readingData.exportAllTime/ }))

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/archive/data-export?scope=time'))
    expect(capturedBlob).not.toBeNull()
    expect(capturedBlob!.type).toBe('text/csv;charset=utf-8')
    expect(await capturedBlob!.text()).toContain('Book,Author,Granularity')
    clickSpy.mockRestore()
  })

  it('remembers the last selected tab and falls back cleanly when manage is unavailable', () => {
    const { unmount } = render(<ReadingDataManagerButton bookId="book-123" bookTitle="My Book" />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))
    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabManage' }))
    expect(localStorage.getItem('bd-reading-data-manager-tab')).toBe('manage')

    // Close and reopen in single-book mode: stays on manage
    fireEvent.click(screen.getByRole('button', { name: 'library.cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))
    expect(screen.getByRole('tab', { name: 'readingData.tabManage' })).toHaveAttribute('aria-selected', 'true')
    unmount()

    // Global mode has no manage tab: falls back to import without clearing the saved preference
    const globalView = render(<ReadingDataManagerButton />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))
    expect(screen.getByRole('tab', { name: 'readingData.tabImport' })).toHaveAttribute('aria-selected', 'true')
    expect(localStorage.getItem('bd-reading-data-manager-tab')).toBe('manage')

    // Choosing export updates the remembered tab
    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabExport' }))
    expect(localStorage.getItem('bd-reading-data-manager-tab')).toBe('export')
    globalView.unmount()

    render(<ReadingDataManagerButton bookId="book-456" bookTitle="Other Book" />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))
    expect(screen.getByRole('tab', { name: 'readingData.tabExport' })).toHaveAttribute('aria-selected', 'true')
  })

  it('remembers export scope, export format, and delete scope across modal reopens', () => {
    const first = render(<ReadingDataManagerButton bookId="book-123" bookTitle="My Book" />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))

    // Persist export scope + format (notes + markdown)
    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabExport' }))
    fireEvent.click(screen.getByRole('radio', { name: 'readingData.scopeNotes' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Markdown' }))
    expect(localStorage.getItem('bd-reading-data-export-scope')).toBe('notes')
    expect(localStorage.getItem('bd-reading-data-export-format')).toBe('markdown')

    // Persist delete scope (time)
    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabManage' }))
    fireEvent.click(screen.getByRole('radio', { name: 'readingData.scopeTime' }))
    expect(localStorage.getItem('bd-reading-data-delete-scope')).toBe('time')
    fireEvent.click(screen.getByRole('button', { name: 'library.cancel' }))
    first.unmount()

    // Reopen in another book instance: restores manage + time, and export restores notes + markdown
    render(<ReadingDataManagerButton bookId="book-456" bookTitle="Other Book" />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))
    expect(screen.getByRole('radio', { name: 'readingData.scopeTime' })).toBeChecked()

    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabExport' }))
    expect(screen.getByRole('radio', { name: 'readingData.scopeNotes' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Markdown' })).toBeChecked()

    // Switching export scope to time narrows displayed format to JSON without overwriting saved markdown
    fireEvent.click(screen.getByRole('radio', { name: 'readingData.scopeTime' }))
    expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked()
    expect(localStorage.getItem('bd-reading-data-export-format')).toBe('markdown')
  })

  it('gracefully handles unavailable localStorage when reading or writing preferences', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })

    render(<ReadingDataManagerButton bookId="book-123" bookTitle="My Book" />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))
    expect(screen.getByRole('tab', { name: 'readingData.tabImport' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabExport' }))
    expect(screen.getByRole('radio', { name: 'readingData.scopeAll' })).toBeChecked()

    getSpy.mockRestore()
    setSpy.mockRestore()
  })
})
