import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { useBackNavigation } from '@/hooks/useBackNavigation'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'

import ProfileAccountSection from './components/ProfileAccountSection'
import ProfileReadingShowcase from './components/ProfileReadingShowcase'
import ProfileSettingsDialog from './components/ProfileSettingsDialog'
import ProfileStatsSection from './components/ProfileStatsSection'
import { useProfilePrefs } from './profile-prefs'

export default function Profile() {
  const _ = useTranslation()
  usePageTitle(_('profile.title'))
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isGuest = !user || user.role === 'guest' || user.guest === true
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { showStats, showShowcase } = useProfilePrefs()
  const onBack = useBackNavigation('/')

  useEffect(() => {
    if (isGuest) void navigate({ to: '/' })
  }, [isGuest, navigate])

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
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{_('profile.title')}</h1>
      </header>

      <ProfileAccountSection onOpenSettings={() => setSettingsOpen(true)} />

      {showStats && <ProfileStatsSection />}

      {showShowcase && <ProfileReadingShowcase />}

      {!showStats && !showShowcase && (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/50 p-8 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900/30 dark:text-stone-400">
          {_('profile.allModulesHidden')}
        </div>
      )}

      <ProfileSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
