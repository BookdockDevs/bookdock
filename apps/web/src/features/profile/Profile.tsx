import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router'

import QueryErrorState from '@/components/ui/QueryErrorState'
import { useBackNavigation } from '@/hooks/useBackNavigation'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useReaderProfile } from '@/features/reviews/hooks/useReviews'
import { useAuthStore } from '@/stores/auth.store'

import ProfileAccountSection from './components/ProfileAccountSection'
import ProfileReadingShowcase from './components/ProfileReadingShowcase'
import ProfilePending from './components/ProfilePending'
import ProfileSettingsDialog from './components/ProfileSettingsDialog'
import ProfileStatsSection from './components/ProfileStatsSection'
import ActivityFeed from '@/features/activity/ActivityFeed'

export default function Profile() {
  const _ = useTranslation()
  usePageTitle(_('profile.title'))
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const search = useSearch({ from: '/profile' })
  const publicView = Boolean(search.userId && search.userId !== user?.id)
  const targetUserId = publicView ? search.userId : user?.id
  const reader = useReaderProfile(targetUserId)
  const isGuest = !user
  const [settingsOpen, setSettingsOpen] = useState(false)
  const onBack = useBackNavigation('/')
  const activityFilter = search.activity ?? 'all'
  const readerReturn = { to: '/profile' as const, search: { userId: publicView ? search.userId : undefined, activity: search.activity }, sourceHistoryIndex: location.state.__TSR_index }
  const setActivityFilter = (activity: 'all' | 'idea' | 'review') => {
    void navigate({ to: '/profile', replace: true, resetScroll: false, search: (previous) => ({ ...previous, activity: activity === 'all' ? undefined : activity }), state: (previous) => ({ ...previous }) })
  }

  useEffect(() => {
    if (isGuest) void navigate({ to: '/' })
  }, [isGuest, navigate])

  if (!user) return null

  if (reader.isPending) {
    return <ProfilePending />
  }

  if (reader.isError || !reader.data) {
    return <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6"><QueryErrorState isRetrying={reader.isFetching} onRetry={() => void reader.refetch()} /></div>
  }

  const data = reader.data.data
  const isOwner = !publicView && (data.isOwner ?? true)

  if (publicView) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6 pb-24 sm:pb-32">
        <header className="flex items-center justify-between gap-3 border-b border-stone-200/70 pb-3 dark:border-stone-800/70">
          <Link to="/" onClick={onBack} aria-label={_('profile.back')} className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200" title={_('profile.back')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
          </Link>
          <h1 className="flex-1 text-xl font-bold tracking-tight text-stone-900 sm:text-2xl dark:text-stone-50">{_('profile.title')}</h1>
          <span aria-hidden="true" className="h-8 w-8 shrink-0" />
        </header>

        <ProfileAccountSection profile={data.author} editable={false} />
        {data.visibility === 'private' ? (
          <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/50 p-8 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900/30 dark:text-stone-400">{_('profile.private')}</div>
        ) : (
          <>
            {data.showStats && <ProfileStatsSection summary={data.summary} />}
            {data.showShowcase && <ProfileReadingShowcase books={data.currentlyReading} readerReturn={{ to: '/profile', search: { userId: search.userId, activity: search.activity } }} showBrowseLink={false} />}
            {data.showPublicActivity && (
              <ActivityFeed
                scope="personal"
                targetId={targetUserId}
                type={activityFilter}
                historyIndex={location.state.__TSR_index}
                readerReturn={readerReturn}
                title={<h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100">{_('profile.timeline')}</h2>}
                onFilterChange={(value) => { if (value === 'all' || value === 'idea' || value === 'review') setActivityFilter(value) }}
              />
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6 pb-24 sm:pb-32">
      <header className="flex items-center justify-between gap-3 border-b border-stone-200/70 pb-3 dark:border-stone-800/70">
        <Link to="/" onClick={onBack} aria-label={_('profile.back')} className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200" title={_('profile.back')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
        </Link>
        <h1 className="flex-1 text-xl font-bold tracking-tight text-stone-900 sm:text-2xl dark:text-stone-50">{_('profile.title')}</h1>
        <button type="button" aria-label={_('profile.settings')} title={_('profile.settings')} onClick={() => setSettingsOpen(true)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-300">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 0-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 0-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        </button>
      </header>

      <ProfileAccountSection profile={data.author} />

      {data.showStats !== false && <ProfileStatsSection summary={data.summary} showArchiveLink />}
      {data.showShowcase !== false && <ProfileReadingShowcase books={data.currentlyReading} readerReturn={{ to: '/profile' }} />}
      <ActivityFeed
        scope="personal"
        targetId={targetUserId}
        type={activityFilter}
        historyIndex={location.state.__TSR_index}
        readerReturn={readerReturn}
        title={<h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100">{_('profile.timeline')}</h2>}
        onFilterChange={(value) => { if (value === 'all' || value === 'idea' || value === 'review') setActivityFilter(value) }}
      />

      {isOwner && settingsOpen && <ProfileSettingsDialog bio={data.author.bio ?? ''} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
