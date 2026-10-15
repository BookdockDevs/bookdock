import { useEffect, useRef, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router'

import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'

import StatsSettingsButton from '@/features/stats/components/StatsSettingsButton'

import ArchiveOverviewDashboard from './components/ArchiveOverviewDashboard'
import ArchiveSidebar, { type ArchiveSidebarParams } from './components/ArchiveSidebar'
import BookNotesView from './BookNotesView'
import { archiveScrollKey, restoreScrollWithRetry, saveArchiveScrollRecord, takeArchiveScrollRecord } from './archive-scroll'

export default function Archive() {
  const _ = useTranslation()
  usePageTitle(_('archive.title'))
  const navigate = useNavigate()
  const search = useSearch({ from: '/archive' })
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const isGuest = !user
  const leftRef = useRef<HTMLDivElement | null>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const searchRef = useRef(search)
  searchRef.current = search
  const scrollKey = archiveScrollKey(search)
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
  // exit — return to the recorded entry source instead. Replace swaps only
  // the current entry, leaving earlier archive entries behind for normal
  // per-entry browser back. The library restores the requested scroll below
  // once its own list is rendered; nothing scrolls here, where the
  // destination would still show skeletons.
  const exitArchive = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    const recorded = location.state.archiveReturn
    const searchReturn = location.state.librarySearchReturn
    // Preserve the library search session across the exit: clearing the
    // search on the library must still restore its pre-search filters, page
    // and scroll position. The snapshot's back flag cannot survive — archive
    // entries were pushed after the search entry, so stepping back would no
    // longer reach the pre-search page; force the explicit restore path.
    const state = (previous: typeof location.state) => ({
      ...previous,
      archiveReturn: undefined,
      librarySearchReturn: searchReturn ? { ...searchReturn, back: false } : undefined,
      archiveExitScroll: recorded?.scrollTop ?? 0,
    })
    if (recorded) void navigate({ to: '/', search: recorded.search, replace: true, resetScroll: false, state })
    else void navigate({ to: '/', replace: true, resetScroll: false, state })
  }

  if (isGuest) return null

  const patch = (next: Partial<typeof search>) => {
    // Forward history state: navigating without it resets the recorded
    // archive exit source on the first internal move.
    void navigate({ to: '/archive', search: { ...search, ...next }, state: (previous) => ({ ...previous }) })
  }

  const listParams: ArchiveSidebarParams = {
    q: search.q ?? '',
    type: search.type ?? 'all',
    sort: search.sort ?? 'recent',
  }

  const hasSelectedBook = Boolean(search.bookId)
  const isMobileStatsView = !hasSelectedBook && search.tab === 'stats'

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col min-h-screen lg:h-screen lg:max-h-screen lg:min-h-0 lg:overflow-hidden">
      {/* 顶部主导航头（大屏下固定在顶部，不随左右两侧滚动） */}
      <header className="shrink-0 flex items-center justify-between border-b border-stone-200/70 px-4 py-3 sm:px-6 lg:px-8 dark:border-stone-800/70">
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
        <StatsSettingsButton />
      </header>

      {/* 核心工作区：桌面端独立分栏滚动，移动端自适应单栏 */}
      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[340px_1fr] lg:overflow-hidden">
        {/* 左栏（大屏常驻且独立垂直滚动；小屏在未选书且未看移动统计时显示） */}
        <div
          ref={leftRef}
          onScroll={(event) => {
            liveScroll.current.left = event.currentTarget.scrollTop
          }}
          className={
            hasSelectedBook || isMobileStatsView
              ? 'hidden lg:flex lg:h-full lg:flex-col lg:overflow-y-auto lg:border-r lg:border-stone-200/70 lg:bg-stone-50/50 lg:px-4 lg:py-4 dark:lg:border-stone-800/70 dark:lg:bg-stone-900/20'
              : 'flex h-full flex-col p-4 sm:p-5 lg:overflow-y-auto lg:border-r lg:border-stone-200/70 lg:bg-stone-50/50 lg:px-4 lg:py-4 dark:lg:border-stone-800/70 dark:lg:bg-stone-900/20'
          }
        >
          <ArchiveSidebar
            selectedBookId={search.bookId}
            params={listParams}
            baseSearch={search}
            onChange={(next) => patch(next)}
            onSelectOverview={() => patch({ bookId: undefined, tab: 'stats' })}
            onSelectBook={(bookId) => patch({ bookId, tab: undefined })}
          />
        </div>

        {/* 右栏主画布（大屏拥有独立垂直滚动条，滚动完全不影响左栏） */}
        <main
          ref={mainRef}
          onScroll={(event) => {
            liveScroll.current.main = event.currentTarget.scrollTop
          }}
          className={
            hasSelectedBook || isMobileStatsView
              ? 'flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8'
              : 'hidden lg:block lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:p-8'
          }
        >
          {hasSelectedBook && search.bookId ? (
            /* 单书详情（上数据微看板 + 下笔记流） */
            <div className="max-w-4xl">
              <BookNotesView
                bookVersionId={search.bookId}
                bookType={search.bookType ?? 'all'}
                bookSort={search.bookSort ?? 'chapter'}
                onChange={(next) => patch(next)}
                onBack={() => patch({ bookId: undefined })}
                hideBack={false}
              />
            </div>
          ) : (
            /* 全景总览大看板 */
            <div className="max-w-4xl">
              <ArchiveOverviewDashboard
                baseSearch={search}
                showBack={isMobileStatsView}
                onBack={() => patch({ tab: undefined })}
                onSelectType={(type) => patch({ type, tab: undefined })}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
