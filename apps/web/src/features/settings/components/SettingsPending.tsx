import { Link } from '@tanstack/react-router'
import { useBackNavigation } from '@/hooks/useBackNavigation'
import { useTranslation } from '@/hooks/useTranslation'

export default function SettingsPending() {
  const _ = useTranslation()
  const onBack = useBackNavigation('/')

  return (
    <div className="mx-auto flex max-w-4xl flex-col p-4 sm:p-6" aria-busy="true">
      <header className="sticky top-0 z-30 -mx-4 -mt-4 mb-4 flex items-center justify-between border-b border-stone-200/70 bg-stone-50/85 px-4 py-3 backdrop-blur-md dark:border-stone-800/70 dark:bg-stone-950/85 sm:-mx-6 sm:-mt-6 sm:mb-6 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            onClick={onBack}
            aria-label={_('settings.back')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            title={_('settings.back')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{_('settings.title')}</h1>
        </div>
      </header>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <nav className="flex w-auto shrink-0 gap-1 sm:w-44 sm:flex-col">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex h-9 animate-pulse items-center gap-2.5 rounded-xl bg-stone-100 dark:bg-stone-800/60" />
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
            <div className="h-5 w-24 rounded bg-stone-200/70 dark:bg-stone-800" />
            <div className="mt-6 space-y-4">
              <div className="h-9 rounded-xl bg-stone-100 dark:bg-stone-800/60" />
              <div className="h-9 rounded-xl bg-stone-100 dark:bg-stone-800/60" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
