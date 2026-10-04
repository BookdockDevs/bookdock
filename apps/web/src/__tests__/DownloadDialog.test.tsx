import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { useBookReplacements } from '@/api/hooks/useReplacements'
import DownloadDialog from '@/features/library/components/DownloadDialog'
import DownloadDialogHost from '@/features/library/components/DownloadDialogHost'
import { downloadBook, downloadEditedTxt, downloadOriginalTxt } from '@/features/library/download'
import i18n from '@/i18n/i18n'
import { useAuthStore } from '@/stores/auth.store'
import { useDownloadStore } from '@/stores/download.store'

vi.mock('@/api/hooks/useReplacements', () => ({ useBookReplacements: vi.fn() }))
vi.mock('@/features/library/download', () => ({
  downloadBook: vi.fn(), downloadEpub: vi.fn(), downloadEditedTxt: vi.fn(), downloadOriginalTxt: vi.fn(),
}))

const preferenceKey = 'bd-download-choice:download-user'

beforeEach(async () => {
  vi.resetAllMocks()
  localStorage.removeItem(preferenceKey)
  useDownloadStore.getState().close()
  useAuthStore.setState({ user: { id: 'download-user', username: 'reader', role: 'member' } })
  vi.mocked(useBookReplacements).mockReturnValue({ data: { data: [] }, isPending: false, isError: false } as ReturnType<typeof useBookReplacements>)
  await i18n.changeLanguage('zh-CN')
})

describe('DownloadDialog', () => {
  it('remembers only a successfully completed download and prevents duplicates while preparing', async () => {
    let complete!: () => void
    vi.mocked(downloadOriginalTxt).mockReturnValue(new Promise<void>((resolve) => { complete = resolve }))
    const close = vi.fn()
    render(<DownloadDialog bookId="book" title="Book" sourceFormat="epub" userId="download-user" onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'TXT' }))
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    fireEvent.click(screen.getByRole('button', { name: '正在准备…' }))
    expect(downloadOriginalTxt).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(preferenceKey)).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(close).not.toHaveBeenCalled()
    await act(async () => complete())
    expect(JSON.parse(localStorage.getItem(preferenceKey)!)).toEqual({ format: 'txt', edited: false })
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps failed choices available for retry without saving them', async () => {
    vi.mocked(downloadOriginalTxt).mockRejectedValueOnce(new ApiError('NO_EXPORTABLE_TEXT', 'No text'))
    const close = vi.fn()
    render(<DownloadDialog bookId="book" title="Book" sourceFormat="epub" userId="download-user" onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'TXT' }))
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('没有可导出的文字')
    expect(localStorage.getItem(preferenceKey)).toBeNull()
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
  })

  it('restores a successful edited TXT choice after replacement data arrives', async () => {
    localStorage.setItem(preferenceKey, JSON.stringify({ format: 'txt', edited: true }))
    vi.mocked(useBookReplacements).mockReturnValue({ isPending: true } as ReturnType<typeof useBookReplacements>)
    const props = { bookId: 'book', title: 'Book', sourceFormat: 'epub' as const, userId: 'download-user', onClose: vi.fn() }
    const view = render(<DownloadDialog {...props} />)
    expect(screen.getByRole('button', { name: '下载' })).toBeDisabled()
    vi.mocked(useBookReplacements).mockReturnValue({ data: { data: [{ enabled: true, effectiveEnabled: true }] }, isPending: false } as ReturnType<typeof useBookReplacements>)
    view.rerender(<DownloadDialog {...props} />)
    expect(screen.getByRole('radio', { name: '校订版' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    expect(downloadEditedTxt).toHaveBeenCalledWith('book', 'Book')
  })

  it('falls back to original EPUB when an edited EPUB choice is unsupported', () => {
    localStorage.setItem(preferenceKey, JSON.stringify({ format: 'epub', edited: true }))
    render(<DownloadDialog bookId="book" title="Book" sourceFormat="epub" userId="download-user" onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    expect(downloadBook).toHaveBeenCalledWith('book', 'Book')
  })

  it('does not load another account’s saved choice', () => {
    localStorage.setItem(preferenceKey, JSON.stringify({ format: 'txt', edited: true }))
    render(<DownloadDialog bookId="book" title="Book" sourceFormat="epub" userId="another-user" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'EPUB' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides a pending action after account switching and rejects guest actions', () => {
    useDownloadStore.getState().open({ id: 'book', title: 'Book', format: 'epub' })
    render(<DownloadDialogHost />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => useAuthStore.setState({ user: { id: 'other', username: 'other', role: 'member' } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    useDownloadStore.getState().close()
    useAuthStore.setState({ user: null })
    useDownloadStore.getState().open({ id: 'book', title: 'Book', format: 'epub' })
    expect(useDownloadStore.getState().target).toBeNull()
  })
})
