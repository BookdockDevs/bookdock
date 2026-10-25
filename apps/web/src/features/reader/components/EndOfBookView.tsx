import { useState } from 'react'
import type { ReadStatus } from '@bookdock/shared'

import { useReadingLedger, useReadingSummary } from '@/api/hooks/reading-records'
import { useReviewBookContext } from '@/features/reviews/hooks/useReviews'
import ReviewEditor from '@/features/reviews/components/ReviewEditor'
import { useTranslation } from '@/hooks/useTranslation'

import { useAnnotations } from '../hooks/useAnnotations'
import { useManualTimerStore } from '../lib/manual-timer-store'
import AddRecordDialog from './AddRecordDialog'

interface EndOfBookViewProps {
  bookId: string
  bookTitle?: string
  readStatus?: ReadStatus | null
  guestReadOnly?: boolean
  onMarkFinished: () => void
  isMarkingFinished?: boolean
}

const STAR_PATH = 'M12 2.5l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.57l-5.9 3.11 1.13-6.58L2.45 9.44l6.6-.96L12 2.5z'

function StarRatingDisplay({ value, size = 15 }: { value: number; size?: number }) {
  const steps = [1, 2, 3, 4, 5]
  return (
    <span
      className="bookdock-eob-stars"
      role="img"
      aria-label={`${value.toFixed(1)} 星`}
    >
      {steps.map((whole) => {
        const fill = Math.min(Math.max(value - (whole - 1), 0), 1)
        const isHalf = fill > 0 && fill < 1
        const gradId = `bd-star-grad-${whole}`
        return (
          <svg
            key={whole}
            viewBox="0 0 24 24"
            className="bookdock-eob-star"
            aria-hidden="true"
            style={{ width: size, height: size }}
          >
            {isHalf && (
              <defs>
                <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
                  <stop offset={`${fill * 100}%`} stopColor="#f59e0b" />
                  <stop offset={`${fill * 100}%`} stopColor="currentColor" stopOpacity="0.22" />
                </linearGradient>
              </defs>
            )}
            <path
              d={STAR_PATH}
              fill={isHalf ? `url(#${gradId})` : (fill >= 1 ? '#f59e0b' : 'currentColor')}
              opacity={isHalf || fill >= 1 ? 1 : 0.22}
            />
          </svg>
        )
      })}
    </span>
  )
}

function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  try {
    const parts = dateStr.split('-')
    if (parts.length === 3) {
      const month = Number(parts[1])
      const day = Number(parts[2])
      return `${month}月${day}日`
    }
    return dateStr
  } catch {
    return dateStr
  }
}

export default function EndOfBookView({
  bookId,
  bookTitle,
  readStatus,
  guestReadOnly = false,
  onMarkFinished,
  isMarkingFinished = false,
}: EndOfBookViewProps) {
  const _ = useTranslation()

  const isFinished = readStatus === 'finished'

  const ledgerQuery = useReadingLedger(bookId, { enabled: !guestReadOnly })
  const ledger = guestReadOnly ? undefined : ledgerQuery.data?.data

  const summaryQuery = useReadingSummary(undefined, undefined, undefined, { enabled: !guestReadOnly })
  const finishedBooksCount = guestReadOnly ? 0 : summaryQuery.data?.data?.scope?.finishedBooks ?? 0
  const finishedRank = Math.max(1, finishedBooksCount + (isFinished ? 0 : 1))

  const { data: annotationsData } = useAnnotations(bookId, { enabled: !guestReadOnly })
  const annotations = annotationsData?.data
  const annotationsCount = annotations?.length ?? 0

  const reviewContext = useReviewBookContext(bookId, !guestReadOnly)
  const ownReview = reviewContext.data?.data?.own
  const hasOwnReview = Boolean(ownReview)

  const [reviewEditorOpen, setReviewEditorOpen] = useState(false)
  const [manualSaveOpen, setManualSaveOpen] = useState(false)

  const manualSessions = useManualTimerStore((s: { sessions: ReturnType<typeof useManualTimerStore.getState>['sessions'] }) => s.sessions)
  const currentManualSession = manualSessions[bookId]

  const handleFinishClick = () => {
    if (currentManualSession && (currentManualSession.phase === 'running' || currentManualSession.phase === 'paused')) {
      useManualTimerStore.getState().pause(bookId)
      setManualSaveOpen(true)
      return
    }
    onMarkFinished()
  }

  const startDateFormatted = formatDate(ledger?.earliestDate)

  // Duration components with split number and unit
  const totalSeconds = ledger?.totalSeconds ?? 0
  const durationHours = Math.floor(totalSeconds / 3600)
  const durationMinutes = Math.floor((totalSeconds % 3600) / 60)
  const effectiveMinutes = durationHours > 0 ? durationMinutes : (totalSeconds > 0 ? Math.max(1, durationMinutes) : 0)

  return (
    <div
      data-testid="end-of-book-view"
      data-tts-skip="true"
      onClick={(e) => e.stopPropagation()}
      className="bookdock-end-of-book"
    >
      <h2 className="bookdock-eob-title">
        {isFinished ? _('reader.endOfBookFinishedTitle') : _('reader.endOfBookTitle')}
      </h2>
      {bookTitle && (
        <div className="bookdock-eob-booktitle">
          《<span>{bookTitle.replace(/^《|》$/g, '')}</span>》
        </div>
      )}

      {/* Finished State Hero Badge (only shown when marked finished) */}
      {isFinished && (
        <div className="bookdock-eob-badge-wrap">
          <div className="bookdock-eob-circle bookdock-eob-circle-finished">
            <span className="bookdock-eob-circle-sub">读完的第</span>
            <span className="bookdock-eob-circle-main">{finishedRank} 本</span>
          </div>
          <span className="bookdock-eob-badge-label">
            {_('reader.endOfBookFinishedBadge')}
          </span>
        </div>
      )}

      {/* 3 Metrics Stats Card (Side-by-side) */}
      <section
        aria-label={_('reader.endOfBookDuration')}
        className={`bookdock-eob-card ${startDateFormatted ? 'has-start-date' : ''}`}
      >
        <div className="bookdock-eob-grid-three">
          {/* Column 1: Duration */}
          <div className="bookdock-eob-col">
            <div className="bookdock-eob-label">{_('reader.endOfBookDuration')}</div>
            <div className="bookdock-eob-val">
              {durationHours > 0 ? (
                <>
                  <span className="bookdock-eob-num">{durationHours}</span>
                  <span className="bookdock-eob-unit">小时</span>
                  {effectiveMinutes > 0 && (
                    <>
                      <span className="bookdock-eob-num" style={{ marginLeft: 3 }}>{effectiveMinutes}</span>
                      <span className="bookdock-eob-unit">分钟</span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <span className="bookdock-eob-num">{effectiveMinutes}</span>
                  <span className="bookdock-eob-unit">分钟</span>
                </>
              )}
            </div>
          </div>

          {/* Column 2: Reading Days */}
          <div className="bookdock-eob-col">
            <div className="bookdock-eob-label">{_('reader.endOfBookDays')}</div>
            <div className="bookdock-eob-val">
              <span className="bookdock-eob-num">{ledger?.readingDays ?? 1}</span>
              <span className="bookdock-eob-unit">天</span>
            </div>
          </div>

          {/* Column 3: Total Notes (想法笔记) */}
          <div className="bookdock-eob-col">
            <div className="bookdock-eob-label">{_('reader.endOfBookNotes')}</div>
            <div className="bookdock-eob-val">
              <span className="bookdock-eob-num">{annotationsCount}</span>
              <span className="bookdock-eob-unit">条</span>
            </div>
          </div>
        </div>

        {startDateFormatted && (
          <div className="bookdock-eob-start-date">
            {_('reader.endOfBookStartedAt', { date: startDateFormatted })}
          </div>
        )}
      </section>

      {/* Actions */}
      <div className="bookdock-eob-actions">
        {!isFinished && !guestReadOnly ? (
          <button
            type="button"
            disabled={isMarkingFinished}
            onClick={handleFinishClick}
            className="bookdock-eob-btn-primary"
          >
            {isMarkingFinished && (
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="bookdock-eob-spinner"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            )}
            <span>{isMarkingFinished ? _('reader.endOfBookMarkingFinished') : _('reader.endOfBookMarkFinished')}</span>
          </button>
        ) : (
          !guestReadOnly && reviewContext.data?.data?.composer?.bookVersionId && (
            <div className="bookdock-eob-review-wrap">
              {hasOwnReview && (
                <div className="bookdock-eob-review-meta">
                  {ownReview?.rating && (
                    <div className="bookdock-eob-stars-row">
                      <StarRatingDisplay value={ownReview.rating} size={15} />
                      <span className="bookdock-eob-rating-num">{ownReview.rating.toFixed(1)}</span>
                    </div>
                  )}
                  {ownReview?.title && (
                    <div className="bookdock-eob-review-preview-title">
                      “{ownReview.title}”
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setReviewEditorOpen(true)}
                className="bookdock-eob-btn-secondary"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <span>{hasOwnReview ? _('reader.endOfBookEditReview') : _('reader.endOfBookWriteReview')}</span>
              </button>
            </div>
          )
        )}
      </div>

      {/* Review Editor Dialog */}
      {reviewEditorOpen && reviewContext.data?.data?.composer?.bookVersionId && (
        <ReviewEditor
          bookVersionId={reviewContext.data.data.composer.bookVersionId}
          existing={reviewContext.data.data.own}
          composer={reviewContext.data.data.composer}
          onClose={() => setReviewEditorOpen(false)}
          onSaved={() => {
            setReviewEditorOpen(false)
            void reviewContext.refetch()
          }}
        />
      )}

      {/* Manual Timer Save Dialog */}
      {manualSaveOpen && currentManualSession && (
        <AddRecordDialog
          bookId={bookId}
          variant="reader"
          manualSession={currentManualSession}
          initialFinished={true}
          onClose={() => setManualSaveOpen(false)}
          onManualSaved={() => {
            setManualSaveOpen(false)
            useManualTimerStore.getState().discard(bookId)
          }}
        />
      )}
    </div>
  )
}
