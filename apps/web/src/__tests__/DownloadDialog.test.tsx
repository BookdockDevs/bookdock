import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '@/api/client'
import DownloadDialog from '@/features/library/components/DownloadDialog'
import DownloadDialogHost from '@/features/library/components/DownloadDialogHost'
import { createBooksArchive, deliverBlob, prepareBookFile } from '@/features/library/download'
import i18n from '@/i18n/i18n'
import { useAuthStore } from '@/stores/auth.store'
import { useDownloadStore } from '@/stores/download.store'

vi.mock('@/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/client')>(), apiGet: vi.fn() }))
vi.mock('@/features/library/download', () => ({
  createBooksArchive: vi.fn(async () => new Blob(['zip'])),
  deliverBlob: vi.fn(),
  prepareBookFile: vi.fn(async (book: { title: string; format: string }) => ({ blob: new Blob([book.title]), filename: `${book.title}.${book.format}` })),
}))

const singlePreferenceKey = 'bd-download-choice:download-user'
const batchPreferenceKey = 'bd-download-choice:batch:download-user'

function renderDialog(element: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>)
}

beforeEach(async () => {
  vi.resetAllMocks()
  localStorage.removeItem(singlePreferenceKey)
  localStorage.removeItem(batchPreferenceKey)
  useDownloadStore.getState().close()
  useAuthStore.setState({ user: { id: 'download-user', username: 'reader', role: 'member' } })
  vi.mocked(apiGet).mockResolvedValue({ data: [] })
  vi.mocked(prepareBookFile).mockImplementation(async (book) => ({ blob: new Blob([book.title]), filename: `${book.title}.${book.format}` }))
  await i18n.changeLanguage('zh-CN')
})

describe('DownloadDialog', () => {
  it('remembers a single-book choice only after delivery and prevents duplicate preparation', async () => {
    let complete!: (file: { blob: Blob; filename: string }) => void
    vi.mocked(prepareBookFile).mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
    const close = vi.fn()
    renderDialog(<DownloadDialog books={[{ id: 'book', title: 'Book', format: 'epub' }]} userId="download-user" onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'TXT' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '下载' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    expect(prepareBookFile).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(singlePreferenceKey)).toBeNull()
    await act(async () => complete({ blob: new Blob(['text']), filename: 'Book.txt' }))
    expect(JSON.parse(localStorage.getItem(singlePreferenceKey)!)).toEqual({ format: 'txt', edited: false })
    expect(deliverBlob).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('retries only failed books and can deliver the successful subset', async () => {
    vi.mocked(prepareBookFile)
      .mockResolvedValueOnce({ blob: new Blob(['one']), filename: 'One.epub' })
      .mockRejectedValueOnce(new Error('second failed'))
    const books = [
      { id: 'one', title: 'One', format: 'epub' as const },
      { id: 'two', title: 'Two', format: 'txt' as const },
    ]
    renderDialog(<DownloadDialog books={books} userId="download-user" onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '下载' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    expect(await screen.findByText('成功 1 本，失败 1 本')).toBeInTheDocument()
    expect(prepareBookFile).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '下载成功的 1 本' }))
    await waitFor(() => expect(createBooksArchive).toHaveBeenCalledOnce())
    expect(vi.mocked(createBooksArchive).mock.calls[0]?.[0]).toHaveLength(1)
    expect(deliverBlob).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^bookdock-books-\d{8}-\d{6}-1-books\.zip$/))
  })

  it('keeps prepared files and allows retry when ZIP creation fails', async () => {
    const close = vi.fn()
    vi.mocked(createBooksArchive).mockRejectedValueOnce(new Error('zip failed'))
    renderDialog(<DownloadDialog books={[
      { id: 'one', title: 'One', format: 'epub' },
      { id: 'two', title: 'Two', format: 'txt' },
    ]} userId="download-user" onClose={close} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '下载' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '下载' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('下载失败，请重试')
    expect(prepareBookFile).toHaveBeenCalledTimes(2)
    expect(close).not.toHaveBeenCalled()
    vi.mocked(createBooksArchive).mockResolvedValueOnce(new Blob(['zip']))
    fireEvent.click(screen.getByRole('button', { name: '下载' }))

    await waitFor(() => expect(createBooksArchive).toHaveBeenCalledTimes(2))
    expect(prepareBookFile).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
  })

  it('aborts ZIP preparation when the dialog closes', async () => {
    let archiveSignal: AbortSignal | undefined
    vi.mocked(createBooksArchive).mockImplementationOnce((_files, signal) => new Promise((_resolve, reject) => {
      archiveSignal = signal
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const close = vi.fn()
    renderDialog(<DownloadDialog books={[
      { id: 'one', title: 'One', format: 'epub' },
      { id: 'two', title: 'Two', format: 'txt' },
    ]} userId="download-user" onClose={close} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '下载' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    await waitFor(() => expect(createBooksArchive).toHaveBeenCalledOnce())
    fireEvent.click(screen.getAllByRole('button', { name: '取消' })[1]!)

    expect(archiveSignal?.aborted).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })

  it('continues original downloads when an unrelated replacement lookup fails', async () => {
    vi.mocked(apiGet)
      .mockRejectedValueOnce(new Error('replacement lookup failed'))
      .mockResolvedValueOnce({ data: [] })
    renderDialog(<DownloadDialog books={[
      { id: 'epub', title: 'Epub', format: 'epub' },
      { id: 'txt', title: 'Text', format: 'txt' },
    ]} userId="download-user" onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '下载' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '下载' }))

    await waitFor(() => expect(createBooksArchive).toHaveBeenCalledOnce())
    expect(prepareBookFile).toHaveBeenCalledTimes(2)
  })

  it('counts only books with failed required replacement lookups and prepares the rest', async () => {
    vi.mocked(apiGet)
      .mockRejectedValueOnce(new Error('replacement lookup failed'))
      .mockResolvedValueOnce({ data: [{ enabled: true, effectiveEnabled: true }] })
    renderDialog(<DownloadDialog books={[
      { id: 'failed', title: 'Failed', format: 'txt' },
      { id: 'ready', title: 'Ready', format: 'txt' },
    ]} userId="download-user" onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '保持原格式' }))
    fireEvent.click(await screen.findByRole('radio', { name: '校订版' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '下载' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '下载' }))

    expect(await screen.findByText('成功 1 本，失败 1 本')).toBeInTheDocument()
    expect(prepareBookFile).toHaveBeenCalledOnce()
    expect(prepareBookFile).toHaveBeenCalledWith({
      id: 'ready', title: 'Ready', sourceFormat: 'txt', format: 'txt', edited: true,
    }, expect.any(AbortSignal))
    expect(screen.getByRole('button', { name: '重试失败的 1 本' })).toBeEnabled()
  })

  it('keeps mixed source formats, applies edited export only to books with effective rules and retries failures only', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ enabled: true, effectiveEnabled: true }] })
    vi.mocked(prepareBookFile)
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce({ blob: new Blob(['txt']), filename: 'Text.txt' })
    const books = [
      { id: 'epub', title: 'Epub', format: 'epub' as const },
      { id: 'txt', title: 'Text', format: 'txt' as const },
    ]
    renderDialog(<DownloadDialog books={books} userId="download-user" onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '保持原格式' }))
    fireEvent.click(screen.getByRole('radio', { name: '校订版' }))
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    await screen.findByText('成功 1 本，失败 1 本')
    expect(prepareBookFile).toHaveBeenNthCalledWith(1, {
      id: 'epub', title: 'Epub', sourceFormat: 'epub', format: 'epub', edited: false,
    }, expect.any(AbortSignal))
    expect(prepareBookFile).toHaveBeenNthCalledWith(2, {
      id: 'txt', title: 'Text', sourceFormat: 'txt', format: 'txt', edited: true,
    }, expect.any(AbortSignal))
    vi.mocked(prepareBookFile).mockResolvedValueOnce({ blob: new Blob(['retry']), filename: 'Epub.epub' })
    fireEvent.click(screen.getByRole('button', { name: '重试失败的 1 本' }))
    await waitFor(() => expect(createBooksArchive).toHaveBeenCalledOnce())
    expect(prepareBookFile).toHaveBeenCalledTimes(3)
    expect(JSON.parse(localStorage.getItem(batchPreferenceKey)!)).toEqual({ format: 'keep', edited: true })
  })

  it('cancels an in-flight fetch when the dialog closes', async () => {
    let signal!: AbortSignal
    vi.mocked(prepareBookFile).mockImplementationOnce((_book, abortSignal) => {
      signal = abortSignal!
      return new Promise(() => {})
    })
    const close = vi.fn()
    renderDialog(<DownloadDialog books={[{ id: 'book', title: 'Book', format: 'epub' }]} userId="download-user" onClose={close} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '下载' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    await waitFor(() => expect(prepareBookFile).toHaveBeenCalledOnce())
    fireEvent.click(screen.getAllByRole('button', { name: '取消' })[1]!)
    expect(signal.aborted).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })

  it('hides a pending action after account switching and rejects guest actions', () => {
    useDownloadStore.getState().open({ id: 'book', title: 'Book', format: 'epub' })
    renderDialog(<DownloadDialogHost />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => useAuthStore.setState({ user: { id: 'other', username: 'other', role: 'member' } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    useDownloadStore.getState().close()
    useAuthStore.setState({ user: null })
    useDownloadStore.getState().open({ id: 'book', title: 'Book', format: 'epub' })
    expect(useDownloadStore.getState().target).toBeNull()
  })
})
