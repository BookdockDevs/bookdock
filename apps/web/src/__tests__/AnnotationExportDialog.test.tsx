import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { AnnotationRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { notify } from '@/lib/notifications'
import i18n from '../i18n/i18n'
import AnnotationExportDialog from '../features/reader/components/AnnotationExportDialog'

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const sampleBook = {
  id: 'book-123',
  title: '三体',
  author: '刘慈欣',
}

const sampleAnnotations: AnnotationRes[] = [
  {
    id: 'note-1',
    bookId: 'book-123',
    cfiRange: 'epubcfi(/6/2!/4/2)',
    cfiAnchor: null,
    type: 'note',
    color: 'blue',
    style: 'highlight',
    text: '给岁月以文明，而不是给文明以岁月。',
    note: '经典名句',
    chapter: '第一章',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
]

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('AnnotationExportDialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    localStorage.clear()
    vi.mocked(apiGet).mockResolvedValue({ data: sampleBook })
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    window.URL.revokeObjectURL = vi.fn()
  })

  it('renders book information and selected annotation count banner', async () => {
    renderWithClient(
      <AnnotationExportDialog
        bookId="book-123"
        annotations={sampleAnnotations}
        sort="chapter"
        chapterOrder={[{ label: '第一章', href: 'chapter:1' }]}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('三体')).toBeInTheDocument()
    })
    expect(screen.getAllByText(/刘慈欣/).length).toBeGreaterThan(0)
    expect(screen.getByText(/已选择 1 条/)).toBeInTheDocument()
  })

  it('allows switching export formats and updating live preview', async () => {
    renderWithClient(
      <AnnotationExportDialog
        bookId="book-123"
        annotations={sampleAnnotations}
        sort="chapter"
        chapterOrder={[{ label: '第一章', href: 'chapter:1' }]}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/# 三体/)).toBeInTheDocument()
    })

    // Switch to TXT
    const txtBtn = screen.getByRole('button', { name: /纯文本/i })
    fireEvent.click(txtBtn)
    expect(screen.queryByText(/# 三体/)).not.toBeInTheDocument()
    expect(screen.getByText(/给岁月以文明/)).toBeInTheDocument()

    // Switch to CSV
    const csvBtn = screen.getByRole('button', { name: /CSV 表格/i })
    fireEvent.click(csvBtn)
    expect(screen.getByText(/Book,Author,Chapter/)).toBeInTheDocument()
  })

  it('toggles export options (time, deep link, details)', async () => {
    renderWithClient(
      <AnnotationExportDialog
        bookId="book-123"
        annotations={sampleAnnotations}
        sort="chapter"
        chapterOrder={[{ label: '第一章', href: 'chapter:1' }]}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('三体')).toBeInTheDocument()
    })

    // Toggle include time
    const timeToggle = screen.getByRole('button', { name: /时间/i })
    expect(timeToggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(timeToggle)
    expect(timeToggle).toHaveAttribute('aria-pressed', 'false')

    // Toggle deep link
    const linkToggle = screen.getByRole('button', { name: /深链/i })
    expect(linkToggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(linkToggle)
    expect(linkToggle).toHaveAttribute('aria-pressed', 'false')

    // Deep link is now removed from preview
    expect(screen.queryByText(/\[在 Bookdock 中打开\]/)).not.toBeInTheDocument()
  })

  it('copies content directly to clipboard', async () => {
    renderWithClient(
      <AnnotationExportDialog
        bookId="book-123"
        annotations={sampleAnnotations}
        sort="chapter"
        chapterOrder={[{ label: '第一章', href: 'chapter:1' }]}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('三体')).toBeInTheDocument()
    })

    const copyBtn = screen.getByRole('button', { name: /复制内容/i })
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalled()
    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'annotation.exportCopied' }),
      )
    })
  })

  it('triggers file download on download click', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderWithClient(
      <AnnotationExportDialog
        bookId="book-123"
        annotations={sampleAnnotations}
        sort="chapter"
        chapterOrder={[{ label: '第一章', href: 'chapter:1' }]}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('三体')).toBeInTheDocument()
    })

    const downloadBtn = screen.getByRole('button', { name: /下载文件/i })
    fireEvent.click(downloadBtn)

    expect(window.URL.createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()

    clickSpy.mockRestore()
  })
})
