import { useEffect, useState } from 'react'
import NotificationBell from '@/features/notifications/components/NotificationBell'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'

import { useBackNavigation } from '@/hooks/useBackNavigation'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useProfileSettings } from '@/features/library/hooks'
import { useMyReviews, useReaderProfile } from '@/features/reviews/hooks/useReviews'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useAuthStore } from '@/stores/auth.store'

import ProfileAccountSection from './components/ProfileAccountSection'
import ProfileReadingShowcase from './components/ProfileReadingShowcase'
import ProfileSettingsDialog from './components/ProfileSettingsDialog'
import ProfileStatsSection from './components/ProfileStatsSection'
import MyReviewsSection from '@/features/reviews/components/MyReviewsSection'
import ProfileNotesSection from './components/ProfileNotesSection'

export default function Profile() {
  const _ = useTranslation()
  usePageTitle(_('profile.title'))
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const search = useSearch({ from: '/profile' })
  const publicView = Boolean(search.userId && search.userId !== user?.id)
  const reader = useReaderProfile(publicView ? search.userId : undefined, search.reviewsPage)
  const isGuest = !user
  const [settingsOpen, setSettingsOpen] = useState(false)
  const profile = useProfileSettings()
  const showStats = profile.showStats !== false
  const showShowcase = profile.showShowcase !== false
  // Shares the ['reviews','mine'] cache with MyReviewsSection below, so this
  // adds no request: the "all modules hidden" empty state must not render
  // next to a populated reviews list. The pending window owns the skeleton,
  // so the empty state also stays off until the query settles; a failed query
  // still shows the guidance, which is acceptable.
  const myReviews = useMyReviews(!isGuest && !publicView, search.reviewsPage)
  const hasReviews = (myReviews.data?.data.entries.length ?? 0) > 0
  const onBack = useBackNavigation('/')

  useEffect(() => {
    if (isGuest && !publicView) void navigate({ to: '/' })
  }, [isGuest, publicView, navigate])

  if (publicView) {
    return <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between"><Link to="/" className="text-sm text-stone-500">{_('profile.back')}</Link><NotificationBell /></div>
      {reader.isPending ? <div role="status" className="h-24 animate-pulse rounded-2xl bg-stone-500/10" />
        : reader.isError ? <QueryErrorState isRetrying={reader.isFetching} onRetry={() => void reader.refetch()} />
        : reader.data && <>
          <h1 className="text-xl font-bold">{reader.data.data.author.name}</h1>
          <MyReviewsSection publicView archive={reader.data.data.reviews} page={search.reviewsPage} onPageChange={(reviewsPage) => void navigate({ to: '/profile', search: { ...search, reviewsPage } })} />
        </>}
    </div>
  }

  if (!user || isGuest) return null

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex items-center gap-3 border-b border-stone-200/70 pb-3 dark:border-stone-800/70">
        <Link
          to="/"
          onClick={onBack}
          aria-label={_('profile.back')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          title={_('profile.back')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="flex-1 text-xl font-bold tracking-tight sm:text-2xl">{_('profile.title')}</h1>
        <NotificationBell />
      </header>

      <ProfileAccountSection onOpenSettings={() => setSettingsOpen(true)} />

      {showStats && <ProfileStatsSection />}

      {showShowcase && <ProfileReadingShowcase />}

      <ProfileNotesSection page={search.notesPage ?? 1} bookId={search.bookId} onChange={(notesPage, bookId) => void navigate({ to: '/profile', search: { ...search, notesPage, bookId } })} />

      <MyReviewsSection page={search.reviewsPage} onPageChange={(reviewsPage) => void navigate({ to: '/profile', search: { ...search, reviewsPage } })} />

      {!showStats && !showShowcase && !hasReviews && !myReviews.isPending && (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/50 p-8 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900/30 dark:text-stone-400">
          {_('profile.allModulesHidden')}
        </div>
      )}

      <ProfileSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
