import { useEffect, useRef, useState } from 'react'

import QueryErrorState from '@/components/ui/QueryErrorState'
import IdeaDetailModal from '@/features/reader/components/IdeaDetailModal'
import { useTranslation } from '@/hooks/useTranslation'

import ActivityCard from './components/ActivityCard'
import ReviewActivityModal from './components/ReviewActivityModal'
import { activityScrollKey, useActivityScrollPreservation } from './activity-scroll'
import { useActivity, type ActivityFilter, type ActivityScope } from './hooks'
import type { ReaderReturn } from '@/features/reader/reader-return'
import { useAuthStore } from '@/stores/auth.store'

interface ActivityFeedProps {
  scope: ActivityScope
  targetId?: string
  type: ActivityFilter
  libraryName?: string
  readerReturn?: ReaderReturn
  historyIndex?: number
  onFilterChange?: (type: ActivityFilter) => void
  onOpenCatalogWork?: (workId: string) => void
  title?: React.ReactNode
  onOpenNavigation?: () => void
}

export default function ActivityFeed({ scope, targetId, type, onFilterChange, onOpenCatalogWork, libraryName, readerReturn, historyIndex, title, onOpenNavigation }: ActivityFeedProps) {
  const _ = useTranslation()
  const sectionRef = useRef<HTMLElement>(null)
  const viewerId = useAuthStore((state) => state.user?.id)
  const scrollKey = activityScrollKey(viewerId, scope, targetId, type, historyIndex)
  const saveScroll = useActivityScrollPreservation(scrollKey)
  const query = useActivity(scope, targetId, type)
  const [idea, setIdea] = useState<{ id: string; bookVersionId: string; title: string } | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const pages = query.data?.pages ?? []
  const items = pages.flatMap((page) => page.data.items)
  const canManage = pages.some((page) => page.data.canManage)
  useEffect(() => {
    if (type === 'management' && !query.isPending && pages.length > 0 && !canManage) onFilterChange?.('all')
  }, [canManage, onFilterChange, pages.length, query.isPending, type])
  const filters: Array<{ value: ActivityFilter; key: string }> = scope === 'personal'
    ? [{ value: 'all', key: 'activity.all' }, { value: 'idea', key: 'activity.ideas' }, { value: 'review', key: 'activity.reviews' }]
    : [{ value: 'all', key: 'activity.all' }, { value: 'idea', key: 'activity.ideas' }, { value: 'review', key: 'activity.reviews' }, { value: 'catalog', key: 'activity.catalog' }, ...(canManage ? [{ value: 'management' as const, key: 'activity.management' }] : [])]

  const handleFilterClick = (filterValue: ActivityFilter) => {
    if (filterValue === type) return
    if (sectionRef.current) {
      const rect = sectionRef.current.getBoundingClientRect()
      if (rect.top < 0) {
        window.scrollTo({ top: window.scrollY + rect.top - 16, behavior: 'instant' })
      }
    }
    onFilterChange?.(filterValue)
  }

  return (
    <section ref={sectionRef} className="mx-auto flex flex-col gap-4 min-h-[50vh] pb-20 max-w-4xl w-full" aria-label={_('profile.timeline')}>
      {(title || onFilterChange) && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            {onOpenNavigation && (
              <button
                type="button"
                aria-label={_('library.openNavigation')}
                title={_('library.openNavigation')}
                onClick={onOpenNavigation}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-900 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-100 md:hidden"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            {title && (
              typeof title === 'string' ? (
                <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100">
                  {title}
                </h2>
              ) : (
                title
              )
            )}
          </div>
          {onFilterChange && (
            <div className="flex flex-wrap items-center gap-1.5" role="tablist">
              {filters.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  role="tab"
                  aria-selected={filter.value === type}
                  onClick={() => handleFilterClick(filter.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    filter.value === type
                      ? 'bg-stone-900 text-white shadow-2xs dark:bg-stone-100 dark:text-stone-900'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200/80 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
                  }`}
                >
                  {_(filter.key)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {query.isPending && !query.data && <div role="status" className="h-32 animate-pulse rounded-2xl bg-stone-500/10" />}
      {query.isError && <QueryErrorState isRetrying={query.isFetching} onRetry={() => void query.refetch()} />}
      {!query.isPending && !query.isError && items.length === 0 && <p className="rounded-2xl border border-dashed border-stone-200 p-12 text-center text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400">{type !== 'all' ? _('activity.filterEmpty') : scope === 'library' ? _('activity.libraryEmpty') : _('profile.timelineEmpty')}</p>}
      {items.length > 0 && <div className={`flex flex-col gap-3 transition-opacity duration-150 ${query.isPlaceholderData ? 'opacity-50 pointer-events-none' : ''}`}>{items.map((item) => <ActivityCard key={item.eventId} item={item} scope={scope} type={type} libraryName={libraryName} onOpenIdea={(id, bookVersionId, title) => setIdea({ id, bookVersionId, title })} onOpenReview={setReviewId} onOpenCatalogWork={onOpenCatalogWork} />)}</div>}
      {query.hasNextPage && <button type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} className="self-center rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-600 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300">{query.isFetchingNextPage ? _('activity.loading') : _('activity.loadMore')}</button>}
      {idea && <IdeaDetailModal ideaId={idea.id} bookVersionId={idea.bookVersionId} title={idea.title} theme="app" readerReturn={readerReturn} onBeforeReaderNavigate={saveScroll} onClose={() => setIdea(null)} />}
      {reviewId && <ReviewActivityModal reviewId={reviewId} onClose={() => setReviewId(null)} />}
    </section>
  )
}
