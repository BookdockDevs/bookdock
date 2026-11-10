import { fireEvent, render as renderUi, screen, waitFor } from '@testing-library/react'
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

  it('renders 3 tabs in single book mode and supports manage tab with locator and delete', async () => {
    vi.mocked(apiDelete).mockResolvedValueOnce({ success: true })
    const onBookDeleted = vi.fn()
    render(<ReadingDataManagerButton bookId="book-123" bookTitle="My Book" onBookDeleted={onBookDeleted} />)
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))

    expect(screen.getByRole('tab', { name: 'readingData.tabManage' })).toBeInTheDocument()

    // Switch to Manage tab
    fireEvent.click(screen.getByRole('tab', { name: 'readingData.tabManage' }))
    expect(screen.getByText('readingImport.locatorTitle')).toBeInTheDocument()
    expect(screen.getByText('readingData.deleteArchive')).toBeInTheDocument()

    // Open locator
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.locatorAction' }))
    expect(screen.getByTestId('mock-locator-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mock-locator-close'))

    // Trigger delete
    fireEvent.click(screen.getByRole('button', { name: 'reader.sessionDelete' }))
    const alert = screen.getByRole('alertdialog')
    fireEvent.click(alert.querySelector('button[type="button"]')!)
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
})
