import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'

import { useBackNavigation } from '@/hooks/useBackNavigation'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useProfileSettingsState } from '@/features/library/hooks'
import { useReaderProfile } from '@/features/reviews/hooks/useReviews'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useAuthStore } from '@/stores/auth.store'

import ProfileAccountSection from './components/ProfileAccountSection'
import ProfileReadingShowcase from './components/ProfileReadingShowcase'
import ProfileSettingsDialog from './components/ProfileSettingsDialog'
import ProfileStatsSection from './components/ProfileStatsSection'

export default function Profile() {
  const _ = useTranslation()
  usePageTitle(_('profile.title'))
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const search = useSearch({ from: '/profile' })
  const publicView = Boolean(search.userId && search.userId !== user?.id)
  const reader = useReaderProfile(publicView ? search.userId : undefined)
  const isGuest = !user
  const [settingsOpen, setSettingsOpen] = useState(false)
  const {
    profile,
    isReady: profileReady,
    isError: profileError,
    isFetching: profileFetching,
    refetch: refetchProfile,
  } = useProfileSettingsState()
  const showStats = profileReady && profile?.showStats !== false
  const showShowcase = profileReady && profile?.showShowcase !== false
  const onBack = useBackNavigation('/')

  useEffect(() => {
    if (isGuest && !publicView) void navigate({ to: '/' })
  }, [isGuest, publicView, navigate])

  if (publicView) {
    return <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between"><Link to="/" className="text-sm text-stone-500 transition-colors hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200">{_('profile.back')}</Link></div>
      {reader.isPending ? <div role="status" aria-label={_('common.loading') || 'Loading'} className="h-24 animate-pulse rounded-2xl bg-stone-500/10 motion-reduce:animate-none" />
        : reader.isError ? <QueryErrorState isRetrying={reader.isFetching} onRetry={() => void reader.refetch()} />
        : reader.data && <>
          <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">{reader.data.data.author.name}</h1>
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
        <h1 className="flex-1 text-xl font-bold tracking-tight text-stone-900 sm:text-2xl dark:text-stone-50">{_('profile.title')}</h1>
      </header>

      <ProfileAccountSection onOpenSettings={() => setSettingsOpen(true)} />

      {!profileReady ? (
        profileError ? (
          <QueryErrorState
            className="rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900"
            isRetrying={profileFetching}
            onRetry={() => void refetchProfile()}
          />
        ) : (
          <div className="space-y-6" aria-busy="true">
            <div className="h-44 animate-pulse rounded-2xl bg-stone-500/10 motion-reduce:animate-none" />
          </div>
        )
      ) : (
        <>
          {showStats && <ProfileStatsSection />}
          {showShowcase && <ProfileReadingShowcase />}
          {!showStats && !showShowcase && (
            <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/50 p-8 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900/30 dark:text-stone-400">
              {_('profile.allModulesHidden')}
            </div>
          )}
        </>
      )}

      <ProfileSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
