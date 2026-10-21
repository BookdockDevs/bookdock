import { Link } from '@tanstack/react-router'

import { useBackNavigation } from '@/hooks/useBackNavigation'
import { useTranslation } from '@/hooks/useTranslation'

export default function ArchivePending() {
  const _ = useTranslation()
  const onBack = useBackNavigation('/')

  return (
    <div className="flex w-full flex-col min-h-screen lg:h-screen lg:max-h-screen lg:min-h-0 lg:overflow-hidden" role="status" aria-busy="true">
      {/* 顶部主导航头骨架 */}
      <div className="shrink-0 mx-auto w-full max-w-6xl">
        <header className="flex items-center justify-between border-b border-stone-200/70 px-4 py-3 sm:px-6 lg:px-8 dark:border-stone-800/70">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              onClick={onBack}
              aria-label={_('archive.back')}
              title={_('archive.back')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-stone-900 sm:text-2xl dark:text-stone-50">
              {_('archive.title')}
            </h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="h-8 w-28 animate-pulse rounded-lg bg-stone-200/70 dark:bg-stone-800/70" />
            <div className="h-8 w-8 animate-pulse rounded-lg bg-stone-200/70 dark:bg-stone-800/70" />
          </div>
        </header>
      </div>

      {/* 核心工作区骨架 */}
      <div className="flex-1 min-h-0 lg:flex lg:overflow-hidden">
        {/* 左侧占位 */}
        <div aria-hidden="true" className="hidden lg:block shrink-0 w-[max(0px,calc((100vw-72rem)/2))]" />

        {/* 左栏书单列表骨架 */}
        <div className="hidden lg:flex lg:w-[340px] lg:shrink-0 lg:h-full lg:flex-col lg:border-r lg:border-stone-200/70 lg:bg-stone-50/50 lg:px-4 lg:py-4 dark:lg:border-stone-800/70 dark:lg:bg-stone-900/20">
          <div className="h-9 w-full animate-pulse rounded-xl bg-stone-200/70 dark:bg-stone-800/70 mb-3" />
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 w-full animate-pulse rounded-xl bg-stone-200/50 dark:bg-stone-800/50" />
            ))}
          </div>
        </div>

        {/* 右栏主看板骨架 */}
        <main className="flex-1 min-h-0 p-4 sm:p-6 lg:py-8 lg:pl-8 lg:pr-[max(2rem,calc((100vw-72rem)/2+2rem))]">
          <div className="w-full max-w-3xl space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone-200/60 dark:bg-stone-800/60" />
              ))}
            </div>
            <div className="h-64 animate-pulse rounded-2xl bg-stone-200/50 dark:bg-stone-800/50" />
          </div>
        </main>
      </div>
    </div>
  )
}
