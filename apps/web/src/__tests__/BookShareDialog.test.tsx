import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiDelete, apiGet, apiPost } from '@/api/client'
import BookShareDialog from '@/features/library/components/BookShareDialog'
import i18n from '@/i18n/i18n'
import { useToastStore } from '@/stores/toast.store'

vi.mock('@/api/client', () => ({
  BASE_URL: '/api/v1',
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}))

function renderDialog(versionId = 'v1', onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BookShareDialog
        target={{ versionId, title: '三体', format: 'epub', versionLabel: '精校版' }}
        userId="u1"
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
}

describe('BookShareDialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    useToastStore.getState().clearToasts()
    await i18n.changeLanguage('zh-CN')
  })

  it('defaults to 7d, generates a link, and remembers the selected duration', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: null })
    vi.mocked(apiPost).mockResolvedValue({
      data: { url: '/api/v1/book-shares/download/tok1', duration: 'permanent', expiresAt: null },
    })

    renderDialog('v1')

    expect(screen.getByText('精校版 · EPUB')).toBeInTheDocument()
    const sevenDays = await screen.findByRole('radio', { name: '7 天' })
    expect(sevenDays).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('radio', { name: '永久' }))
    fireEvent.click(screen.getByRole('button', { name: '生成链接' }))

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/book-shares/books/v1', {
        libraryId: undefined,
        duration: 'permanent',
        replace: false,
      })
    })

    const linkInput = await screen.findByLabelText('下载链接')
    expect(linkInput).toHaveValue(`${window.location.origin}/api/v1/book-shares/download/tok1`)
    expect(linkInput).toHaveAttribute('readonly')
    expect(screen.getByText('永久有效')).toBeInTheDocument()
    expect(localStorage.getItem('bd-book-share-duration:u1')).toBe('permanent')
    expect(useToastStore.getState().toasts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'success', message: { key: 'library.bookShare.generated' } }),
    ]))
  })

  it('supports regenerating and revoking an active link with confirmation', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      data: { url: '/api/v1/book-shares/download/old', duration: '1d', expiresAt: Date.now() + 86_400_000 },
    })
    vi.mocked(apiPost).mockResolvedValue({
      data: { url: '/api/v1/book-shares/download/new', duration: '30d', expiresAt: Date.now() + 30 * 86_400_000 },
    })
    vi.mocked(apiDelete).mockResolvedValue({ data: null })

    renderDialog('v2')

    await screen.findByLabelText('下载链接')
    fireEvent.click(screen.getByRole('radio', { name: '30 天' }))
    fireEvent.click(screen.getByRole('button', { name: '重新生成链接' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/book-shares/books/v2', {
        libraryId: undefined,
        duration: '30d',
        replace: true,
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '撤销链接' }))
    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }))

    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith('/book-shares/books/v2')
    })
    expect(await screen.findByRole('button', { name: '生成链接' })).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'success', message: { key: 'library.bookShare.regenerated' } }),
      expect.objectContaining({ type: 'success', message: { key: 'library.bookShare.revoked' } }),
    ]))
  })
})
