import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import { useAuthStore } from '@/stores/auth.store'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import InstanceSettingsSection from './components/InstanceSettingsSection'
import UserManagementSection from './components/UserManagementSection'
import LanguageSwitcher from './components/LanguageSwitcher'

type SectionId = 'general' | 'instance' | 'users'

export default function Settings() {
  const _ = useTranslation()
  const user = useAuthStore((s) => s.user)
  const isOwner = user?.role === 'owner' && user.guest !== true
  const [active, setActive] = useState<SectionId>('general')

  const sections: { id: SectionId; label: string }[] = [
    { id: 'general', label: _('settings.general') },
    ...(isOwner
      ? [
          { id: 'instance' as const, label: _('admin.instanceSettings') },
          { id: 'users' as const, label: _('admin.userManagement') },
        ]
      : []),
  ]

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
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

      <div className="flex items-start gap-6">
        <nav className="sticky top-6 flex w-40 shrink-0 flex-col gap-0.5">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={cn(
                'rounded-lg px-3 py-2 text-left text-[13px] transition-all',
                active === s.id
                  ? 'bg-white font-medium text-stone-900 shadow-sm ring-1 ring-stone-200/70 dark:bg-stone-900 dark:text-stone-50 dark:ring-stone-800'
                  : 'text-stone-500 hover:bg-stone-200/50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/50 dark:hover:text-stone-100',
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {active === 'general' && (
            <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <h2 className="mb-4 text-sm font-medium">{_('settings.general')}</h2>
              <LanguageSwitcher />
            </section>
          )}
          {active === 'instance' && isOwner && <InstanceSettingsSection />}
          {active === 'users' && isOwner && <UserManagementSection />}
        </div>
      </div>
    </div>
  )
}
