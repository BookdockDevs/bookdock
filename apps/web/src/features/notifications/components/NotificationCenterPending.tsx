import { Link } from '@tanstack/react-router'

import { useBackNavigation } from '@/hooks/useBackNavigation'
import { useTranslation } from '@/hooks/useTranslation'

export default function NotificationCenterPending() {
  const _ = useTranslation()
  const onBack = useBackNavigation('/')

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6" role="status" aria-busy="true">
      <header className="flex items-center gap-3">
        <Link
          to="/"
          onClick={onBack}
          aria-label={_('profile.back')}
          className="text-sm text-stone-500 transition-colors hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
        >
          {_('profile.back')}
        </Link>
        <h1 className="flex-1 text-xl font-bold text-stone-900 dark:text-stone-100">
          {_('notificationCenter.title')}
        </h1>
      </header>
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-stone-200/80 bg-white/60 p-3 dark:border-stone-800 dark:bg-stone-900/60" />
        ))}
      </div>
    </div>
  )
}
