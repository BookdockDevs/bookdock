import { useEffect, useRef, type MouseEvent } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'

import Stats from '@/features/stats/Stats'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { cn } from '@/lib/utils'

import AllRecordsView, { type AllRecordsParams } from './AllRecordsView'
import BookNotesView from './BookNotesView'
import RecordsHome from './RecordsHome'
export default function Archive() {
  const _ = useTranslation()
  usePageTitle(_('archive.title'))
  const navigate = useNavigate()
  const search = useSearch({ from: '/archive' })
  const user = useAuthStore((s) => s.user)
  const isGuest = !user
  const scrollPositions = useRef<{ home: number; all: number }>({ home: 0, all: 0 })
  const previousView = useRef(search.view)

  useEffect(() => {
    if (isGuest) void navigate({ to: '/' })
  }, [isGuest, navigate])

  useEffect(() => {
    const previous = previousView.current
    previousView.current = search.view
    const target = search.view === 'all' ? 'all' : search.view == null ? 'home' : null
    if (previous === search.view) return
    const top = target ? scrollPositions.current[target] : 0
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top, behavior: 'auto' }))
    return () => window.cancelAnimationFrame(frame)
  }, [search.view])

  if (isGuest) return null

  const tab = search.tab ?? 'records'
  const patch = (next: Partial<typeof search>) => {
    void navigate({ to: '/archive', search: { ...search, ...next } })
  }
  const exitArchive = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    void navigate({ to: '/', replace: true })
  }
  const captureHomeScroll = () => { scrollPositions.current.home = window.scrollY }
  const captureAllScroll = () => { scrollPositions.current.all = window.scrollY }
  const listParams: AllRecordsParams = { q: search.q ?? '', type: search.type ?? 'all', sort: search.sort ?? 'recent', page: search.page ?? 1 }
  const isChildView = search.view === 'all' || (search.view === 'book' && Boolean(search.bookId))

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
      {!isChildView && (
        <>
          <header className="flex items-center gap-3">
            <Link
              to="/"
              onClick={exitArchive}
              aria-label={_('archive.back')}
              title={_('archive.back')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-300"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
            </Link>
            <div className="flex-1">
              <h1 className="text-2xl font-bold tracking-tight">{_('archive.title')}</h1>
              <p className="text-sm text-stone-500 dark:text-stone-400">{_('archive.subtitle')}</p>
            </div>
          </header>

          <nav aria-label={_('archive.title')} className="flex items-center gap-6 border-b border-stone-200/70 dark:border-stone-800/70">
            {(['records', 'stats'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => patch({ tab: value, view: undefined, bookId: undefined })}
                className={cn(
                  '-mb-px border-b-2 px-1 pb-2 text-[15px] transition-colors',
                  tab === value
                    ? 'border-stone-900 font-semibold text-stone-900 dark:border-stone-100 dark:text-stone-50'
                    : 'border-transparent text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300',
                )}
              >
                {_(value === 'records' ? 'archive.records' : 'archive.statistics')}
              </button>
            ))}
          </nav>
        </>
      )}

      {tab === 'stats' ? (
        <Stats hideHeader />
      ) : search.view === 'book' && search.bookId ? (
        <BookNotesView
          bookVersionId={search.bookId}
          bookType={search.bookType ?? 'all'}
          bookSort={search.bookSort ?? 'chapter'}
          onChange={(next) => patch(next)}
          onBack={() => {
            if (search.from === 'all') {
              patch({ view: 'all', bookId: undefined, from: undefined, bookType: undefined, bookSort: undefined })
            } else {
              patch({ view: undefined, bookId: undefined, from: undefined, bookType: undefined, bookSort: undefined })
            }
          }}
        />
      ) : search.view === 'all' ? (
        <AllRecordsView
          params={listParams}
          baseSearch={search}
          onChange={(next) => patch(next)}
          onOpenBook={captureAllScroll}
          onBack={() => patch({ view: undefined })}
        />
      ) : (
        <RecordsHome baseSearch={search} onOpenChild={captureHomeScroll} />
      )}
    </div>
  )
}
