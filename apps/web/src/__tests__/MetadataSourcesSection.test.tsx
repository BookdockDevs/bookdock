import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import MetadataSourcesSection from '@/features/settings/components/MetadataSourcesSection'

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  apiUpload: vi.fn(),
  extractZipPreview: vi.fn(),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    apiGet: mocks.apiGet,
    apiPost: mocks.apiPost,
    apiPut: mocks.apiPut,
    apiDelete: mocks.apiDelete,
    apiUpload: mocks.apiUpload,
  }
})

vi.mock('@/lib/personal-source-zip', () => ({
  extractZipPreview: mocks.extractZipPreview,
}))

vi.mock('@/lib/notifications', () => ({
  notify: {
    success: mocks.notifySuccess,
    error: mocks.notifyError,
  },
}))

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, unknown>) => (
    params ? `${key}:${JSON.stringify(params)}` : key
  ),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: { user: { id: string } | null }) => unknown) => selector({ user: { id: 'u1' } }),
}))

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MetadataSourcesSection />
    </QueryClientProvider>,
  )
}

describe('MetadataSourcesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/integrations/metadata-lookup/config') {
        return { data: { weread: false, googlebooks: false, keys: {} } }
      }
      if (path === '/integrations/personal-sources') {
        return { data: [] }
      }
      return { data: {} }
    })
    mocks.extractZipPreview.mockImplementation(async (file: File) => ({
      iconUrl: null,
      name: file.name.replace(/\.zip$/i, ''),
    }))
  })

  it('remembers the last selected add-source mode across reopen and remount', async () => {
    const view = renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'metadataLookup.addSource' }))
    const zipTab = screen.getByRole('button', { name: 'metadataLookup.sourceModeZip' })
    const githubTab = screen.getByRole('button', { name: 'metadataLookup.sourceModeGitHub' })
    expect(githubTab).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(zipTab)
    expect(zipTab).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('metadataLookup.sourceDropHint')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'metadataLookup.cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'metadataLookup.addSource' }))
    expect(screen.getByRole('button', { name: 'metadataLookup.sourceModeZip' })).toHaveAttribute('aria-pressed', 'true')

    view.unmount()
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'metadataLookup.addSource' }))
    expect(screen.getByRole('button', { name: 'metadataLookup.sourceModeZip' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('supports selecting and installing multiple ZIP packages at once while rejecting non-ZIP files', async () => {
    mocks.apiUpload.mockResolvedValue({ data: { sourceId: 'src1' } })
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'metadataLookup.addSource' }))
    fireEvent.click(screen.getByRole('button', { name: 'metadataLookup.sourceModeZip' }))

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.multiple).toBe(true)

    const zipA = new File(['a'], 'source-a.zip', { type: 'application/zip' })
    const zipB = new File(['b'], 'source-b.zip', { type: 'application/zip' })
    const txt = new File(['c'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [zipA, txt, zipB] } })

    expect(mocks.notifyError).toHaveBeenCalledWith({ key: 'metadataLookup.sourceZipOnly' })
    await waitFor(() => {
      expect(screen.getByText('source-a')).toBeInTheDocument()
      expect(screen.getByText('source-b')).toBeInTheDocument()
    })
    expect(screen.getByText('metadataLookup.sourceDropHint')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'metadataLookup.install' }))

    await waitFor(() => {
      expect(mocks.apiUpload).toHaveBeenCalledTimes(2)
    })
    expect(mocks.apiUpload).toHaveBeenNthCalledWith(1, '/integrations/personal-sources/install/zip', zipA)
    expect(mocks.apiUpload).toHaveBeenNthCalledWith(2, '/integrations/personal-sources/install/zip', zipB)
    expect(mocks.notifySuccess).toHaveBeenCalledWith({
      key: 'metadataLookup.installMultipleSuccess',
      params: { count: 2 },
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps failed ZIP items with inline errors when a multi-ZIP install partially fails', async () => {
    const zipA = new File(['a'], 'source-a.zip', { type: 'application/zip' })
    const zipB = new File(['b'], 'source-b.zip', { type: 'application/zip' })
    mocks.apiUpload
      .mockResolvedValueOnce({ data: { sourceId: 'src1' } })
      .mockRejectedValueOnce(new ApiError('VALIDATION_ERROR', 'Bad package'))

    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'metadataLookup.addSource' }))
    fireEvent.click(screen.getByRole('button', { name: 'metadataLookup.sourceModeZip' }))

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [zipA, zipB] } })

    await waitFor(() => {
      expect(screen.getByText('source-a')).toBeInTheDocument()
      expect(screen.getByText('source-b')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'metadataLookup.install' }))

    await waitFor(() => {
      expect(mocks.notifyError).toHaveBeenCalledWith({
        key: 'metadataLookup.installPartialError',
        params: { installed: 1, failed: 1 },
      })
    })
    expect(screen.queryByText('source-a')).toBeNull()
    expect(screen.getByText('source-b')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('errors.invalidInput')
  })
})
