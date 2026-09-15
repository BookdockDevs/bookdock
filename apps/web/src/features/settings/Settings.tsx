import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearch } from '@tanstack/react-router'

import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { cn } from '@/lib/utils'

import InstanceSettingsSection from './components/InstanceSettingsSection'
import UserManagementSection from './components/UserManagementSection'
import LanguageSwitcher from './components/LanguageSwitcher'
import TrashSettingsRow from './components/TrashSettingsRow'
import ReadingDataSettingsSection from './components/ReadingDataSettingsSection'
import FontsSettingsSection from './components/FontsSettingsSection'
import TransformsSettingsSection from './components/TransformsSettingsSection'
import TocRulesSettingsSection from './components/TocRulesSettingsSection'
import AccountSection from './components/AccountSection'
import TtsSettingsSection from './components/TtsSettingsSection'
import AiSettingsSection from './components/AiSettingsSection'

type SectionId = 'general' | 'account' | 'reading' | 'library' | 'admin'

export default function Settings() {
  const _ = useTranslation()
  usePageTitle(_('settings.title'))
  const user = useAuthStore((s) => s.user)
  const isOwner = user?.role === 'owner' && user.guest !== true
  const isGuest = user?.role === 'guest' || user?.guest === true
  const search = useSearch({ from: '/settings' })
  const [active, setActive] = useState<SectionId>(search.section ?? 'general')

  useEffect(() => {
    if (search.section) setActive(search.section)
    if (search.section === 'reading' && search.focus === 'tts') {
      window.requestAnimationFrame(() => document.getElementById('tts-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [search.focus, search.section])

  const sections: { id: SectionId; label: string; icon: ReactNode }[] = [
    {
      id: 'general',
      label: _('settings.general'),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" x2="20" y1="21" y2="21" />
          <line x1="4" x2="20" y1="14" y2="14" />
          <line x1="4" x2="20" y1="7" y2="7" />
          <circle cx="9" cy="7" r="2" />
          <circle cx="15" cy="14" r="2" />
          <circle cx="7" cy="21" r="2" />
        </svg>
      ),
    },
    // The guest account is shared and anonymous: no personal profile to edit
    ...(!isGuest && user
      ? [
          {
            id: 'account' as const,
            label: _('settings.account'),
            icon: (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            ),
          },
        ]
      : []),
    {
      id: 'reading',
      label: _('settings.reading'),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      ),
    },
    {
      id: 'library',
      label: _('settings.library'),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="18" rx="1" />
          <rect x="14" y="3" width="7" height="18" rx="1" />
        </svg>
      ),
    },
    ...(isOwner
      ? [
          {
            id: 'admin' as const,
            label: _('settings.admin'),
            icon: (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
              </svg>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:gap-6 sm:p-6">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          aria-label={_('settings.back')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-300"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold">{_('settings.title')}</h1>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <nav className="sticky top-0 flex w-full shrink-0 gap-1 overflow-x-auto pb-1 sm:top-6 sm:w-44 sm:flex-col sm:overflow-visible sm:pb-0">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={cn(
                'flex items-center gap-2.5 shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-left text-[13px] transition-all',
                active === s.id
                  ? 'bg-white font-medium text-stone-900 shadow-sm ring-1 ring-stone-200/70 dark:bg-stone-800 dark:text-stone-50 dark:ring-stone-700/60 dark:shadow-xs'
                  : 'text-stone-500 hover:bg-stone-200/50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/50 dark:hover:text-stone-100',
              )}
            >
              <span className={cn('shrink-0 transition-colors', active === s.id ? 'text-stone-700 dark:text-stone-200' : 'text-stone-400 dark:text-stone-500')}>
                {s.icon}
              </span>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {active === 'general' && (
            <div className="flex flex-col gap-6">
              <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
                <h2 className="mb-4 text-sm font-medium">{_('settings.general')}</h2>
                <LanguageSwitcher />
              </section>
              <ReadingDataSettingsSection />
            </div>
          )}
          {active === 'account' && !isGuest && <AccountSection />}
          {active === 'reading' && (
            <div className="flex flex-col gap-6">
              <TocRulesSettingsSection />
              <FontsSettingsSection />
              <TtsSettingsSection id="tts-settings" />
              <AiSettingsSection id="ai-settings" />
              <TransformsSettingsSection />
            </div>
          )}
          {active === 'library' && (
            <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
              <h2 className="mb-4 text-sm font-medium">{_('settings.trash')}</h2>
              <TrashSettingsRow />
            </section>
          )}
          {active === 'admin' && isOwner && (
            <div className="flex flex-col gap-6">
              <InstanceSettingsSection />
              <UserManagementSection />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
