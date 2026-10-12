import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { Review, ReviewBookContext } from '@bookdock/shared'

import SmartMenu, { menuItemClass } from '@/components/ui/SmartMenu'
import { ChatBubbleIcon, CheckIcon, HeartIcon, LockIcon } from '@/features/reader/components/annotation-icons'
import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { computeDropdownPosition, type SmartPosition } from '@/lib/position'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import { useReviewAction } from '../hooks/useReviews'
import { reviewExcerpt } from '../lib/markdown'
import ReviewTime from './ReviewTime'
import StarRating from './StarRating'

export type FilterTab = 'all' | 'mine'
export type SortOption = 'newest' | 'oldest' | 'highest' | 'lowest'

const PAGE_SIZE = 10
const SORT_MENU_WIDTH = 172

const sortOptions: Array<{ value: SortOption; labelKey: string }> = [
  { value: 'newest', labelKey: 'review.sortNewest' },
  { value: 'oldest', labelKey: 'review.sortOldest' },
  { value: 'highest', labelKey: 'review.sortHighestRating' },
  { value: 'lowest', labelKey: 'review.sortLowestRating' },
]

const SORT_MENU_HEIGHT = sortOptions.length * 36 + 8

function compareReviewId(a: Review, b: Review): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Time sorts by createdAt, rating sorts by rating; ties fall back to
 *  createdAt then stable id so the order never jumps between renders. */
function compareReviews(a: Review, b: Review, sortOption: SortOption): number {
  if (sortOption === 'oldest') {
    return (a.createdAt ?? 0) - (b.createdAt ?? 0) || compareReviewId(a, b)
  }
  if (sortOption === 'highest') {
    return (b.rating ?? 0) - (a.rating ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0) || compareReviewId(a, b)
  }
  if (sortOption === 'lowest') {
    return (a.rating ?? 0) - (b.rating ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0) || compareReviewId(a, b)
  }
  return (b.createdAt ?? 0) - (a.createdAt ?? 0) || compareReviewId(a, b)
}

export interface AllReviewsViewProps {
  context: ReviewBookContext | null | undefined
  canReview: boolean
  onOpenCompose: () => void
  onOpenEdit: (review: Review) => void
  onOpenReviewDetail: (review: Review) => void
}

function ReviewItem({
  review,
  onOpenReviewDetail,
}: {
  review: Review
  onOpenReviewDetail: (review: Review) => void
}) {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
  const likeAction = useReviewAction(review.id)

  const authorAvatar = avatarUrl(review.author.avatarKey)
  const excerpt = review.body ? reviewExcerpt(review.body, review.bodyFormat, 220) : ''

  function handleToggleLike(e: React.MouseEvent) {
    e.stopPropagation()
    if (!user || likeAction.isPending) return
    likeAction.mutate(
      { type: 'like', liked: !review.liked },
      {
        onError: (err) => notify.error(getUserErrorNotification(err, 'review.discussionFailed')),
      },
    )
  }

  function openDetail(e: React.SyntheticEvent) {
    // The inner like button stops propagation itself; anything else
    // on the card opens the review detail.
    if ((e.target as HTMLElement).closest('button')) return
    onOpenReviewDetail(review)
  }

  const showMetaRow =
    (review.visibility === 'private' && !review.provenance) || review.visibility === 'shared'

  return (
    <article
      onClick={openDetail}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpenReviewDetail(review)
      }}
      tabIndex={0}
      className="cursor-pointer py-4 outline-none first:pt-2 focus-visible:ring-2 focus-visible:ring-stone-400"
    >
      {/* Row 1: Author, time, badges, rating, more menu */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {authorAvatar ? (
            <img src={authorAvatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-500/10 text-xs font-medium text-stone-600 dark:text-stone-400">
              {review.author.name.slice(0, 1)}
            </span>
          )}
          <span className="text-sm font-medium text-stone-800 dark:text-stone-200">
            {review.author.name}
          </span>
          {review.own && (
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              {_('review.ownBadge')}
            </span>
          )}
          {review.visibility === 'private' && (
            <span className="inline-flex items-center gap-1 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              <LockIcon size={10} />
              {_('review.visibilityPrivate')}
            </span>
          )}
          <span className="text-xs text-stone-400 dark:text-stone-500">
            <ReviewTime createdAt={review.createdAt} editedAt={review.editedAt} />
          </span>
        </div>

        {review.rating != null ? (
          <div className="flex shrink-0 items-center">
            <StarRating value={review.rating} size={14} />
          </div>
        ) : null}
      </div>

      {/* Row 2: Optional title */}
      {review.title && (
        <h4 className="mt-1.5 text-sm font-semibold text-stone-900 dark:text-stone-100">
          {review.title}
        </h4>
      )}

      {/* Row 4: Body excerpt */}
      {excerpt && (
        <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-stone-600 dark:text-stone-300">
          {excerpt}
        </p>
      )}

      {/* Row 4: likes and comments */}
      {showMetaRow && (
        <div className="mt-2.5 flex items-center justify-between text-xs text-stone-400 dark:text-stone-500">
          <div className="flex flex-wrap items-center gap-2">
            {review.visibility === 'private' && !review.provenance && (
              <span>{_('review.visibilityPrivateHint')}</span>
            )}
          </div>

        {review.visibility === 'shared' && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggleLike}
              disabled={!user || likeAction.isPending}
              className={cn(
                'flex items-center gap-1 transition-colors',
                review.liked
                  ? 'font-medium text-red-500'
                  : 'text-stone-400 hover:text-red-500 dark:text-stone-500',
              )}
            >
              <HeartIcon size={13} filled={review.liked} strokeWidth={2} />
              <span className="tabular-nums">{review.likeCount}</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenReviewDetail(review)}
              className="flex items-center gap-1 text-stone-400 transition-colors hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200"
            >
              <ChatBubbleIcon size={13} strokeWidth={2} />
              <span className="tabular-nums">{review.commentCount}</span>
            </button>
          </div>
          )}
        </div>
      )}
    </article>
  )
}

export default function AllReviewsView({
  context,
  canReview,
  onOpenCompose,
  onOpenEdit,
  onOpenReviewDetail,
}: AllReviewsViewProps) {
  const _ = useTranslation()
  const sortMenuId = useId()
  const sortTriggerRef = useRef<HTMLButtonElement>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [sortOption, setSortOption] = useState<SortOption>('newest')
  const [sortMenuPosition, setSortMenuPosition] = useState<SmartPosition | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const own = context?.own ?? null
  const reviewsList = context?.reviews
  const showMine = Boolean(own)

  useEffect(() => {
    if (!showMine && activeTab === 'mine') setActiveTab('all')
  }, [activeTab, showMine])

  // Combine own review with shared reviews for 'all' tab if not already included
  const allReviews = useMemo(() => {
    const shared = Array.isArray(reviewsList) ? reviewsList : []
    if (!own) return [...shared]
    if (shared.some((r) => r.id === own.id)) return [...shared]
    return [own, ...shared]
  }, [own, reviewsList])

  // Filter based on activeTab
  const filteredReviews = useMemo(() => {
    let list: Review[] = []
    const visibleTab = showMine ? activeTab : 'all'
    if (visibleTab === 'all') {
      list = [...allReviews]
    } else if (visibleTab === 'mine') {
      list = own ? [own] : []
    }

    // Sort; the comparator carries createdAt + id tiebreaks.
    return list.sort((a, b) => compareReviews(a, b, sortOption))
  }, [allReviews, own, activeTab, showMine, sortOption])

  const paginatedReviews = filteredReviews.slice(0, visibleCount)
  const hasMore = filteredReviews.length > visibleCount
  const selectedSort = sortOptions.find((option) => option.value === sortOption) ?? sortOptions[0]

  function closeSortMenu() {
    setSortMenuPosition(null)
    sortTriggerRef.current?.focus()
  }

  function toggleSortMenu() {
    if (sortMenuPosition) {
      closeSortMenu()
      return
    }
    const anchor = sortTriggerRef.current?.getBoundingClientRect()
    if (!anchor) return
    setSortMenuPosition(computeDropdownPosition(anchor, SORT_MENU_WIDTH, SORT_MENU_HEIGHT))
  }

  function selectSort(option: SortOption) {
    setSortOption(option)
    setVisibleCount(PAGE_SIZE)
    closeSortMenu()
  }

  function handleSortMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(sortMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      closeSortMenu()
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-6">
          {(['all', 'mine'] as const).filter((tab) => tab === 'all' || showMine).map((tab) => {
            const isActive = activeTab === tab
            const label = tab === 'all' ? _('review.filterAll') : _('review.filterMine')
            return (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setActiveTab(tab)
                  setVisibleCount(PAGE_SIZE)
                }}
                className={cn(
                  'relative pb-2 text-sm font-medium transition-colors',
                  isActive
                    ? '-mb-px border-b-2 border-stone-900 font-semibold text-stone-900 dark:border-stone-100 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 pb-2">
          <div>
            <button
              ref={sortTriggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={Boolean(sortMenuPosition)}
              aria-controls={sortMenuPosition ? sortMenuId : undefined}
              onClick={toggleSortMenu}
              className="flex min-h-8 items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 5v14m0 0-3-3m3 3 3-3M16 19V5m0 0-3 3m3-3 3 3" />
              </svg>
              <span>{_(selectedSort.labelKey)}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {sortMenuPosition && (
              <SmartMenu
                id={sortMenuId}
                innerRef={sortMenuRef}
                triggerRef={sortTriggerRef}
                position={sortMenuPosition}
                onClose={closeSortMenu}
                width={SORT_MENU_WIDTH}
              >
                <div role="menu" aria-label={_('review.sortMenuLabel')} onKeyDown={handleSortMenuKeyDown}>
                  {sortOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortOption === option.value}
                      onClick={() => selectSort(option.value)}
                      className={menuItemClass}
                    >
                      <span className="min-w-0 flex-1 truncate">{_(option.labelKey)}</span>
                      {sortOption === option.value && <CheckIcon size={15} strokeWidth={2.2} />}
                    </button>
                  ))}
                </div>
              </SmartMenu>
            )}
          </div>

          {canReview && (
            <button
              type="button"
              onClick={own ? () => onOpenEdit(own) : onOpenCompose}
              className="flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              <span>{own ? _('review.editReview') : _('review.writeReview')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Reviews list */}
      <div className="mt-2 divide-y divide-stone-100 dark:divide-stone-800">
        {paginatedReviews.length > 0 ? (
          paginatedReviews.map((review) => (
            <ReviewItem
              key={review.id}
              review={review}
              onOpenReviewDetail={onOpenReviewDetail}
            />
          ))
        ) : (
          <p className="py-8 text-center text-xs text-stone-400 dark:text-stone-500">
            {_('review.noFilteredReviews')}
          </p>
        )}
      </div>

      {/* Load More button */}
      {hasMore && (
        <div className="mt-4 flex justify-center pb-2">
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
            className="flex items-center gap-1.5 text-xs text-stone-500 transition-colors hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
          >
            <span>{_('review.loadMoreReviews')}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
