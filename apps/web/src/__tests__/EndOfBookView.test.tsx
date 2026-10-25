import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import i18n from '../i18n/i18n'
import EndOfBookView from '../features/reader/components/EndOfBookView'
import { useManualTimerStore } from '../features/reader/lib/manual-timer-store'

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

const mockLedgerData = {
  totalSeconds: 3600 + 1200, // 1h 20m
  readingDays: 5,
  earliestDate: '2026-09-04',
}

vi.mock('@/api/hooks/reading-records', () => ({
  useReadingLedger: () => ({ data: { data: mockLedgerData } }),
  useReadingSummary: () => ({ data: { data: { scope: { finishedBooks: 3 } } } }),
}))

const mockAnnotations = [
  { id: '1', type: 'highlight', note: null },
  { id: '2', type: 'note', note: 'interesting' },
]

vi.mock('../features/reader/hooks/useAnnotations', () => ({
  useAnnotations: () => ({ data: { data: mockAnnotations } }),
}))

const mockComposer = {
  eligible: true,
  bookVersionId: 'ver-1',
}

const mockUseReviewBookContext = vi.fn()

vi.mock('@/features/reviews/hooks/useReviews', () => ({
  useReviewBookContext: (...args: any[]) => mockUseReviewBookContext(...args),
}))

vi.mock('@/features/reviews/components/ReviewEditor', () => ({
  default: ({ bookVersionId, onClose }: any) => (
    <div data-testid="review-editor-modal">
      <span>Reviewing {bookVersionId}</span>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

vi.mock('../features/reader/components/AddRecordDialog', () => ({
  default: ({ bookId, onClose, onManualSaved, initialFinished }: any) => (
    <div data-testid="manual-save-dialog">
      <span>{bookId}</span>
      <span data-testid="dialog-initial-finished">{String(initialFinished)}</span>
      <button onClick={onManualSaved}>Save Record</button>
      <button onClick={onClose}>Cancel</button>
    </div>
  ),
}))

describe('EndOfBookView', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    useManualTimerStore.setState({ sessions: {} })
    mockUseReviewBookContext.mockReturnValue({
      data: {
        data: {
          composer: mockComposer,
          own: null,
        },
      },
      refetch: vi.fn(),
    })
  })

  it('renders unread view with stats and mark as finished button', () => {
    const onMarkFinished = vi.fn()

    render(
      <EndOfBookView
        bookId="book-1"
        bookTitle="测试书籍"
        readStatus="reading"
        onMarkFinished={onMarkFinished}
      />
    )

    expect(screen.getByRole('heading', { name: '全书完' })).toBeInTheDocument()
    expect(screen.getByText('测试书籍')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.textContent === '1小时20分钟')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.textContent === '5天')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.textContent === '2条')).toBeInTheDocument()
    expect(screen.getByText('想法笔记')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /标记为已读完/ })).toBeInTheDocument()
  })

  it('calls onMarkFinished when mark as finished button is clicked without manual timer', () => {
    const onMarkFinished = vi.fn()

    render(
      <EndOfBookView
        bookId="book-1"
        readStatus="reading"
        onMarkFinished={onMarkFinished}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /标记为已读完/ }))
    expect(onMarkFinished).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('manual-save-dialog')).not.toBeInTheDocument()
  })

  it('triggers manual timer save dialog with initialFinished=true when manual timer is active', () => {
    const onMarkFinished = vi.fn()

    useManualTimerStore.setState({
      sessions: {
        'book-1': {
          bookId: 'book-1',
          userId: 'u1',
          requestId: 'r1',
          timezone: 'UTC',
          date: '2026-10-25',
          phase: 'running',
          startedAt: 1000,
          elapsedMs: 60000,
          lastResumeAt: null,
          suspendedAt: null,
          startCfi: null,
          startFraction: 0.1,
          startChapterIndex: 0,
          lastCfi: null,
          lastFraction: 0.9,
          lastChapterIndex: 5,
          fragments: [],
          coverage: [],
        },
      },
    })

    render(
      <EndOfBookView
        bookId="book-1"
        readStatus="reading"
        onMarkFinished={onMarkFinished}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /标记为已读完/ }))
    expect(onMarkFinished).not.toHaveBeenCalled()
    expect(screen.getByTestId('manual-save-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('dialog-initial-finished')).toHaveTextContent('true')

    // Saving discards session
    fireEvent.click(screen.getByText('Save Record'))
    expect(useManualTimerStore.getState().sessions['book-1']).toBeUndefined()
  })

  it('renders finished view with rank badge and write review button', () => {
    render(
      <EndOfBookView
        bookId="book-1"
        bookTitle="测试书籍"
        readStatus="finished"
        onMarkFinished={vi.fn()}
      />
    )

    expect(screen.getAllByText('已读完').length).toBeGreaterThan(0)
    expect(screen.getByText('3 本')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /写书评/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /标记为已读完/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /改为在读/ })).not.toBeInTheDocument()

    // Clicking write review opens ReviewEditor modal
    fireEvent.click(screen.getByRole('button', { name: /写书评/ }))
    expect(screen.getByTestId('review-editor-modal')).toBeInTheDocument()
  })

  it('renders edit review button when existing review is present', () => {
    mockUseReviewBookContext.mockReturnValueOnce({
      data: {
        data: {
          composer: mockComposer,
          own: {
            id: 'rev-1',
            rating: 4.5,
            title: '精彩的书',
            body: '写的很棒',
            bodyFormat: 'plain',
            visibility: 'shared',
            source: null,
            privateLibraryBookId: null,
            provenance: null,
            author: { id: 'u1', name: 'User', avatarKey: null },
            own: true,
            canDelete: true,
            likeCount: 0,
            liked: false,
            commentCount: 0,
            createdAt: 1000,
            updatedAt: 1000,
            editedAt: null,
          },
        },
      },
      refetch: vi.fn(),
    } as any)

    render(
      <EndOfBookView
        bookId="book-1"
        readStatus="finished"
        onMarkFinished={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /我的书评/ })).toBeInTheDocument()
    expect(screen.getByText('“精彩的书”')).toBeInTheDocument()
    expect(screen.getByText('4.5')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '4.5 星' })).toBeInTheDocument()
  })
})
