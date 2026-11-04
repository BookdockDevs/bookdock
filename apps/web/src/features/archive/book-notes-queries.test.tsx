import type { AnnotationRes, Review } from '@bookdock/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import BookNotesView from './BookNotesView'
import { ApiError } from '@/api/client'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

const chapters = vi.fn((..._args: unknown[]) => ({ data: { data: [] } }))
const detail = vi.fn((..._args: unknown[]) => ({ data: { data: { annotations: [] as AnnotationRes[], reviews: [] as Review[] } }, isPending: false, isError: false }))
vi.mock('./hooks', () => ({ useArchiveBookDetail: (...args: unknown[]) => detail(...args) }))
vi.mock('@/api/hooks/useBookChapters', () => ({ useBookChapters: (...args: unknown[]) => chapters(...args) }))
const mockBook = vi.fn<() => Record<string, unknown>>(() => ({ isPending: true }))
const mockLedger = vi.fn<() => Record<string, unknown>>(() => ({ data: undefined }))
vi.mock('@/features/library/hooks', () => ({ useBook: () => mockBook() }))
vi.mock('@/api/hooks/reading-records', () => ({ useReadingLedger: () => mockLedger(), useBookReadingRecords: () => ({ isPending: true }) }))
vi.mock('@/features/reader/components/IdeaDetailModal', () => ({ default: ({ sourceAvailable, title }: { sourceAvailable: boolean; title: string }) => <div role="dialog" data-source-available={String(sourceAvailable)}>{title} idea detail</div> }))
vi.mock('./components/BookReadingData', () => ({ default: () => <div data-testid="book-reading-data" /> }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn(), Link: ({ children }: { children: React.ReactNode }) => <a href="/books/v1">{children}</a> }))

describe('single-book archive queries', () => {
  it.each([new TypeError('offline'), new ApiError('INTERNAL_ERROR', 'failed', undefined, 500)])('offers retry instead of claiming the original book is unavailable on %s', (error) => {
    const refetch = vi.fn()
    mockBook.mockReturnValue({ isPending: false, isError: true, error, refetch })
    mockLedger.mockReturnValue({ data: { data: { title: 'Retained book', author: 'Author' } } })
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><BookNotesView bookVersionId="v1" bookView="data" bookType="all" bookSort="chapter" onChange={vi.fn()} onBack={vi.fn()} /></QueryClientProvider>)
    expect(screen.queryByText(/readingData.sourceUnavailable/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'errors.retry' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it.each([403, 404])('retains the archive header when book access returns %s', (status) => {
    mockBook.mockReturnValue({ isPending: false, isError: true, error: new ApiError('BOOK_NOT_FOUND', 'unavailable', undefined, status) })
    mockLedger.mockReturnValue({ data: { data: { title: 'Retained book', author: 'Author' } } })
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><BookNotesView bookVersionId="v1" bookView="data" bookType="all" bookSort="chapter" onChange={vi.fn()} onBack={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByRole('heading', { name: 'Retained book' })).toBeInTheDocument()
    expect(screen.queryByText(/archive.sourceUnavailable/)).not.toBeInTheDocument()
    expect(screen.getByText('Author')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'readingData.viewData' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'readingData.viewNotes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'library.startReading' })).not.toBeInTheDocument()
    expect(screen.queryByTitle('library.bookDetails')).not.toBeInTheDocument()
  })

  it('renders the header from ledger metadata while the book detail request is pending', () => {
    mockBook.mockReturnValue({ isPending: true })
    mockLedger.mockReturnValue({ data: { data: { title: 'Ledger book', author: 'Author' } } })
    render(<QueryClientProvider client={new QueryClient()}><BookNotesView bookVersionId="v1" bookView="data" bookType="all" bookSort="chapter" onChange={vi.fn()} onBack={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByRole('heading', { name: 'Ledger book' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'library.startReading' })).not.toBeInTheDocument()
  })

  it('keeps notes and idea details reachable without any original-text links after source loss', () => {
    mockBook.mockReturnValue({ isPending: false, isError: true, error: new ApiError('BOOK_NOT_FOUND', 'unavailable', undefined, 404) })
    mockLedger.mockReturnValue({ data: { data: { title: 'Retained book', author: 'Author' } } })
    detail.mockReturnValue({ data: { data: { annotations: [
      { id: 'highlight', bookId: 'v1', type: 'highlight', text: 'Retained highlight', cfiRange: 'cfi', chapter: 'Chapter', createdAt: 1, updatedAt: 1, locationAvailable: true } as AnnotationRes,
      { id: 'idea', bookId: 'v1', type: 'note', text: 'Quoted passage', note: 'Retained idea', cfiRange: 'idea-cfi', chapter: 'Chapter', createdAt: 2, updatedAt: 2, locationAvailable: true } as AnnotationRes,
    ], reviews: [] }, }, isPending: false, isError: false })
    render(<QueryClientProvider client={new QueryClient()}><BookNotesView bookVersionId="v1" bookView="notes" bookType="all" bookSort="chapter" onChange={vi.fn()} onBack={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText('Retained highlight')).toBeInTheDocument()
    expect(screen.getByText('Retained idea')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(chapters).toHaveBeenLastCalledWith('v1', false)
    fireEvent.click(screen.getByRole('button', { name: 'archive.viewIdeaDetail' }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-source-available', 'false')
    expect(screen.getByRole('dialog')).toHaveTextContent('Retained book idea detail')
  })

  it('only enables note and chapter queries while showing the notes tab', () => {
    mockBook.mockReturnValue({ isPending: true })
    mockLedger.mockReturnValue({ data: undefined })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const props = { bookVersionId: 'v1', bookType: 'all' as const, bookSort: 'chapter' as const, onChange: vi.fn(), onBack: vi.fn() }
    const { rerender } = render(<QueryClientProvider client={client}><BookNotesView {...props} bookView="data" /></QueryClientProvider>)
    expect(screen.getByTestId('book-reading-data')).toBeInTheDocument()
    expect(chapters).toHaveBeenLastCalledWith('v1', false)
    expect(detail).toHaveBeenLastCalledWith('v1', false, undefined)
    rerender(<QueryClientProvider client={client}><BookNotesView {...props} bookView="notes" /></QueryClientProvider>)
    expect(screen.queryByTestId('book-reading-data')).not.toBeInTheDocument()
    expect(chapters).toHaveBeenLastCalledWith('v1', true)
    expect(detail).toHaveBeenLastCalledWith('v1', true, undefined)
  })
})

describe('chapter sort without a book TOC', () => {
  const note = (id: string, chapter: string, importChapterIndex: number | null, cfiRange: string | null = null): AnnotationRes => ({
    id, bookId: 'v1', type: 'highlight', color: 'yellow', style: 'underline',
    text: `text-${id}`, note: null, chapter, chapterHref: null, cfiRange, cfiAnchor: null,
    importChapterIndex, createdAt: 1, updatedAt: 1,
  })

  it('orders chapter groups by the source chapter ordinal when the TOC is unavailable', () => {
    chapters.mockReturnValue({ data: { data: [] } })
    detail.mockReturnValue({ data: { data: { annotations: [
      note('a3', '第三章', 3),
      note('b1', '第一章', 1),
      note('c2', '第二章', 2),
    ], reviews: [] } }, isPending: false, isError: false })
    const { container } = render(<QueryClientProvider client={new QueryClient()}><BookNotesView bookVersionId="v1" bookView="notes" bookType="all" bookSort="chapter" onChange={vi.fn()} onBack={vi.fn()} /></QueryClientProvider>)
    const labels = Array.from(container.querySelectorAll('section[aria-label]')).map((s) => s.getAttribute('aria-label'))
    expect(labels).toEqual(['第一章', '第二章', '第三章'])

    const { container: desc } = render(<QueryClientProvider client={new QueryClient()}><BookNotesView bookVersionId="v1" bookView="notes" bookType="all" bookSort="chapter-desc" onChange={vi.fn()} onBack={vi.fn()} /></QueryClientProvider>)
    expect(Array.from(desc.querySelectorAll('section[aria-label]')).map((s) => s.getAttribute('aria-label'))).toEqual(['第三章', '第二章', '第一章'])
  })

  it('falls back to the CFI spine ordinal for groups without a stored source ordinal', () => {
    chapters.mockReturnValue({ data: { data: [] } })
    detail.mockReturnValue({ data: { data: { annotations: [
      note('late', '第十章', null, 'epubcfi(/6/20!/4,/2:0,/3:5)'),
      note('early', '第二章', null, 'epubcfi(/6/6!/4,/1:0,/2:5)'),
      note('no-position', '未知章节', null, null),
    ], reviews: [] } }, isPending: false, isError: false })
    const { container } = render(<QueryClientProvider client={new QueryClient()}><BookNotesView bookVersionId="v1" bookView="notes" bookType="all" bookSort="chapter" onChange={vi.fn()} onBack={vi.fn()} /></QueryClientProvider>)
    const labels = Array.from(container.querySelectorAll('section[aria-label]')).map((s) => s.getAttribute('aria-label'))
    expect(labels).toEqual(['第二章', '第十章', '未知章节'])
  })

  it('renders tab-specific empty state messages', () => {
    chapters.mockReturnValue({ data: { data: [] } })
    detail.mockReturnValue({ data: { data: { annotations: [], reviews: [] } }, isPending: false, isError: false })
    const tabs = [
      { tab: 'all' as const, expectedKey: 'archive.noBookNotes' },
      { tab: 'highlight' as const, expectedKey: 'archive.noBookHighlights' },
      { tab: 'bookmark' as const, expectedKey: 'archive.noBookBookmarks' },
      { tab: 'idea' as const, expectedKey: 'archive.noBookIdeas' },
      { tab: 'review' as const, expectedKey: 'archive.noBookReviews' },
    ]
    for (const { tab, expectedKey } of tabs) {
      const { unmount } = render(
        <QueryClientProvider client={new QueryClient()}>
          <BookNotesView bookVersionId="v1" bookView="notes" bookType={tab} bookSort="chapter" onChange={vi.fn()} onBack={vi.fn()} />
        </QueryClientProvider>
      )
      expect(screen.getByText(expectedKey)).toBeInTheDocument()
      unmount()
    }
  })
})
