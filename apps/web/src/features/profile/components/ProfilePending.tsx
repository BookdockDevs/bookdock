import { Link } from '@tanstack/react-router'

import { useBackNavigation } from '@/hooks/useBackNavigation'
import { useTranslation } from '@/hooks/useTranslation'

export default function ProfilePending() {
  const _ = useTranslation()
  const onBack = useBackNavigation('/')

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6" aria-busy="true">
      <header className="mb-6 flex items-center gap-3 border-b border-stone-200/70 pb-3 dark:border-stone-800/70">
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
        <div className="h-6 w-28 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" />
      </header>
      <div className="space-y-6">
        {/* Hero Card Skeleton */}
        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="h-24 w-full animate-pulse bg-stone-200/70 sm:h-32 dark:bg-stone-800/70" />
          <div className="px-4 pb-5 sm:px-6 sm:pb-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-5">
                <div className="-mt-12 h-20 w-20 animate-pulse rounded-full bg-stone-200/90 ring-4 ring-white sm:-mt-14 sm:h-24 sm:w-24 dark:bg-stone-700/90 dark:ring-stone-900" />
                <div className="space-y-2 pb-1">
                  <div className="h-6 w-32 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" />
                  <div className="h-3.5 w-24 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" />
                </div>
              </div>
              <div className="h-8 w-24 animate-pulse rounded-lg bg-stone-200/70 pb-1 dark:bg-stone-800" />
            </div>
          </div>
        </div>

        {/* Stats 4-Grid Skeleton */}
        <div className="space-y-3">
          <div className="h-5 w-24 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <div className="h-28 animate-pulse rounded-2xl border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900" />
            <div className="h-28 animate-pulse rounded-2xl border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900" />
            <div className="h-28 animate-pulse rounded-2xl border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900" />
            <div className="h-28 animate-pulse rounded-2xl border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900" />
          </div>
        </div>

        {/* Showcase Skeleton */}
        <div className="space-y-3">
          <div className="h-5 w-24 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-24 animate-pulse rounded-2xl border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900" />
            <div className="h-24 animate-pulse rounded-2xl border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900" />
          </div>
        </div>
      </div>
    </div>
  )
}
