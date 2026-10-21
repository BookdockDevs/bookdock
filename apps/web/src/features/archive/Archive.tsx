import { useEffect, useRef, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useRouter, useSearch } from '@tanstack/react-router'

import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'

import PeriodSelector from '@/features/stats/components/PeriodSelector'
import StatsSettingsButton from '@/features/stats/components/StatsSettingsButton'
import { shiftPeriod, type StatsPeriod } from '@/features/stats/date-utils'
import { localDateString, useReadingSummary } from '@/api/hooks/reading-records'

import ArchiveOverviewDashboard from './components/ArchiveOverviewDashboard'
import ArchiveSidebar, { type ArchiveSidebarParams } from './components/ArchiveSidebar'
import BookNotesView from './BookNotesView'
import { archiveScrollKey, restoreScrollWithRetry, saveArchiveScrollRecord, takeArchiveScrollRecord } from './archive-scroll'
import { resolveArchiveScope } from './archive-scope'

export default function Archive() {
  const _ = useTranslation()
  usePageTitle(_('archive.title'))
  const navigate = useNavigate()
  const router = useRouter({ warn: false })
  const search = useSearch({ from: '/archive' })
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const isGuest = !user
  const leftRef = useRef<HTMLDivElement | null>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const searchRef = useRef(search)
  const { period, anchor, selectedDate, range, query } = resolveArchiveScope(search)
  const scopedSearch = { ...search, period, anchor: localDateString(anchor), timezone: query.timezone }
  searchRef.current = scopedSearch
  const scrollKey = archiveScrollKey(scopedSearch)

  const handlePeriodChange = (p: StatsPeriod) => {
    const next = resolveArchiveScope({ period: p, timezone: query.timezone })
    patch({ period: p, anchor: localDateString(next.anchor), date: undefined })
  }

  const handleShift = (delta: number) => {
    patch({ anchor: localDateString(shiftPeriod(period, anchor, delta)), date: undefined })
  }

  const overallSummary = useReadingSummary(undefined, undefined, query.timezone)
  const firstRecordedDate = overallSummary.data?.data.firstRecordedDate

  const handleSelectAnchor = (d: Date) => {
    patch({ anchor: localDateString(d), date: undefined })
  }

  const handleDrillMonth = (d: Date) => {
    patch({ anchor: localDateString(d), period: 'month', date: undefined })
  }
  const handleSelectDate = (date: string | null) => patch({ date: date || undefined })
  // Live scroll positions: DOM refs are detached before unmount cleanups
  // run, so track the values here instead of reading refs on the way out.
  const liveScroll = useRef({ left: 0, main: 0, win: 0 })

  useEffect(() => {
    const onWindowScroll = () => {
      liveScroll.current.win = window.scrollY
    }
    window.addEventListener('scroll', onWindowScroll, { passive: true })
    return () => window.removeEventListener('scroll', onWindowScroll)
  }, [])

  // Leaving the archive (any destination) remembers this view's scroll
  // positions; returning to the same view restores them below.
  useEffect(() => () => {
    saveArchiveScrollRecord(archiveScrollKey(searchRef.current), { ...liveScroll.current })
  }, [])

  // A same-view return (e.g. reader back) restores the saved positions once
  // the re-created containers can take them; content still loading only
  // clamps the first attempts while the retry loop keeps re-applying.
  useEffect(() => {
    const positions = takeArchiveScrollRecord(scrollKey)
    if (!positions) return
    const cancels: Array<() => void> = []
    const left = leftRef.current
    if (left) {
      const target = positions.left
      cancels.push(restoreScrollWithRetry({
        read: () => left.scrollTop,
        apply: (top) => { left.scrollTop = top },
        target,
      }))
    }
    const main = mainRef.current
    if (main) {
      const target = positions.main
      cancels.push(restoreScrollWithRetry({
        read: () => main.scrollTop,
        apply: (top) => { main.scrollTop = top },
        target,
      }))
    }
    if (positions.win > 0) {
      cancels.push(restoreScrollWithRetry({
        read: () => window.scrollY,
        apply: (top) => window.scrollTo({ top }),
        target: positions.win,
      }))
    }
    return () => {
      for (const cancel of cancels) cancel()
    }
  }, [scrollKey])

  useEffect(() => {
    if (isGuest) void navigate({ to: '/' })
  }, [isGuest, navigate])

  // Exit the whole archive feature: internal moves (overview, single book,
  // filters, sort) push history entries, so a single history.back() cannot
  // exit — traverse directly to the recorded source index instead. The
  // source entry already carries the library scroll request, and the library
  // restores it below once its own list is rendered; nothing scrolls here,
  // where the destination would still show skeletons. Entries without a
  // usable source index retain the explicit replace fallback below.
  const exitArchive = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    const recorded = location.state.archiveReturn
    const searchReturn = location.state.librarySearchReturn
    const currentHistoryIndex = location.state.__TSR_index
    if (recorded?.sourceHistoryIndex !== undefined && recorded.sourceHistoryIndex < currentHistoryIndex) {
      router.history.go(recorded.sourceHistoryIndex - currentHistoryIndex)
      return
    }
    // Preserve the library search session across the explicit fallback:
    // clearing the search on the library must still restore its pre-search
    // filters, page and scroll position.
    const state = (previous: typeof location.state) => ({
      ...previous,
      archiveReturn: undefined,
      librarySearchReturn: searchReturn ? { ...searchReturn, back: false } : undefined,
      archiveExitScroll: recorded?.scrollTop ?? 0,
    })
    if (recorded?.to) {
      void navigate({ to: recorded.to, replace: true, resetScroll: false, state })
    } else if (recorded) {
      void navigate({ to: '/', search: recorded.search, replace: true, resetScroll: false, state })
    } else {
      void navigate({ to: '/', replace: true, resetScroll: false, state })
    }
  }

  if (isGuest) return null

  const patch = (next: Partial<typeof search>) => {
    // Forward history state: navigating without it resets the recorded
    // archive exit source on the first internal move.
    void navigate({ to: '/archive', search: { ...scopedSearch, ...next }, state: (previous) => ({ ...previous }) })
  }

  const listParams: ArchiveSidebarParams = {
    q: search.q ?? '',
    type: search.type ?? 'all',
    sort: search.sort ?? 'recent',
    readStatus: search.readStatus,
    tag: search.tag,
  }

  const hasSelectedBook = Boolean(search.bookId)
  const isMobileOverviewView = !hasSelectedBook && search.view === 'overview'

  return (
    <div className="flex w-full flex-col min-h-screen lg:h-screen lg:max-h-screen lg:min-h-0 lg:overflow-hidden">
      {/* 顶部主导航头（约束在 max-w-6xl 居中，底部线条不触碰两边视口，与设置页保持完全一致的视觉规整感） */}
      <div className="shrink-0 mx-auto w-full max-w-6xl">
        <header className="flex items-center justify-between border-b border-stone-200/70 px-4 py-3 sm:px-6 lg:px-8 dark:border-stone-800/70">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              onClick={exitArchive}
              aria-label={_('archive.back')}
              title={_('archive.back')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-stone-900 sm:text-2xl dark:text-stone-50">
              {_('archive.title')}
            </h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <PeriodSelector
              period={period}
              range={range}
              onPeriodChange={handlePeriodChange}
              onShift={handleShift}
              onSelectAnchor={handleSelectAnchor}
              firstRecordedDate={firstRecordedDate}
            />
            {selectedDate && <button type="button" onClick={() => handleSelectDate(null)} className="text-xs text-blue-600">{selectedDate} · {_('readingData.backPeriod')}</button>}
            <StatsSettingsButton
              bookId={search.bookId}
              onBookDeleted={() => patch({ bookId: undefined, bookView: undefined })}
            />
          </div>
        </header>
      </div>

      {/* 核心工作区：桌面端左侧保留原居中锚点，右栏向右通栏铺满视口，滚动条自然吸附在浏览器窗口最右侧 */}
      <div className="flex-1 min-h-0 lg:flex lg:overflow-hidden">
        {/* 左侧占位：在大屏下保持左侧书单处于原居中位置，不被拉扯到屏幕边缘 */}
        <div aria-hidden="true" className="hidden lg:block shrink-0 w-[max(0px,calc((100vw-72rem)/2))]" />

        {/* 左栏（大屏常驻且独立垂直滚动；小屏在未选书且未看移动统计时显示） */}
        <div
          ref={leftRef}
          onScroll={(event) => {
            liveScroll.current.left = event.currentTarget.scrollTop
          }}
          className={
            hasSelectedBook || isMobileOverviewView
              ? 'hidden lg:flex lg:w-[340px] lg:shrink-0 lg:h-full lg:flex-col lg:overflow-y-auto lg:border-r lg:border-stone-200/70 lg:bg-stone-50/50 lg:px-4 lg:py-4 dark:lg:border-stone-800/70 dark:lg:bg-stone-900/20'
              : 'flex h-full flex-col p-4 sm:p-5 lg:w-[340px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-stone-200/70 lg:bg-stone-50/50 lg:px-4 lg:py-4 dark:lg:border-stone-800/70 dark:lg:bg-stone-900/20'
          }
        >
          <ArchiveSidebar
            selectedBookId={search.bookId}
            params={listParams}
            baseSearch={scopedSearch}
            range={query}
            onChange={(next) => patch(next)}
            onSelectOverview={() => patch({ bookId: undefined, view: 'overview' })}
            onSelectBook={(bookId) => patch({ bookId, view: undefined })}
          />
        </div>

        {/* 右栏主画布（通栏到视口右侧边缘，独立垂直滚动条直接贴在浏览器最右侧，通过右侧 padding 保持内容原宽度与原位置） */}
        <main
          ref={mainRef}
          onScroll={(event) => {
            liveScroll.current.main = event.currentTarget.scrollTop
          }}
          className={
            hasSelectedBook || isMobileOverviewView
              ? 'flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 lg:py-8 lg:pl-8 lg:pr-[max(2rem,calc((100vw-72rem)/2+2rem))]'
              : 'hidden lg:block lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:py-8 lg:pl-8 lg:pr-[max(2rem,calc((100vw-72rem)/2+2rem))]'
          }
        >
          {hasSelectedBook && search.bookId ? (
            /* 单书详情（上数据微看板 + 下笔记流） */
            <div className="w-full max-w-3xl">
              <BookNotesView
                bookVersionId={search.bookId}
                bookView={search.bookView ?? 'data'}
                bookType={search.bookType ?? 'all'}
                bookSort={search.bookSort ?? 'chapter'}
                onChange={(next) => patch(next)}
                onBack={() => patch({ bookId: undefined })}
                hideBack={false}
              />
            </div>
          ) : (
            /* 全景总览大看板 */
            <div className="w-full max-w-3xl">
              <ArchiveOverviewDashboard
                baseSearch={scopedSearch}
                showBack={isMobileOverviewView}
                onBack={() => patch({ view: undefined })}
                onSelectType={(type) => patch({ type, view: undefined })}
                period={period}
                range={range}
                selectedDate={selectedDate}
                selectedTag={search.tag}
                onSelectTag={(tag) => patch({ tag: tag || undefined })}
                selectedReadStatus={search.readStatus}
                onSelectReadStatus={(status) => patch({ readStatus: status === 'all' ? undefined : (status as typeof search.readStatus) })}
                onPeriodChange={handlePeriodChange}
                onShift={handleShift}
                onDrillMonth={handleDrillMonth}
                onSelectDate={handleSelectDate}
                query={query}
                hideControls={true}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
