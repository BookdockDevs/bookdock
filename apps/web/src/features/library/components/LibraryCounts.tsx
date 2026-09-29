import { useTranslation } from '@/hooks/useTranslation'

import { cn } from '@/lib/utils'

function BookOpenIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a4 4 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a4 4 0 0 1 3-3h7z" />
    </svg>
  )
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

interface LibraryCountsProps {
  workCount: number
  memberCount: number
  className?: string
}

/**
 * How a library's size is stated wherever it is shown: icons with the numbers,
 * never spelled-out labels. Shared so the discovery rows and the invitation
 * page cannot drift apart.
 */
export default function LibraryCounts({ workCount, memberCount, className }: LibraryCountsProps) {
  const _ = useTranslation()
  return (
    <div className={cn('flex items-center gap-3 text-xs text-stone-400 dark:text-stone-500', className)}>
      <span className="inline-flex items-center gap-1" title={_('library.workCountLabel')}>
        <BookOpenIcon className="h-3.5 w-3.5" />
        <span>{workCount}</span>
      </span>
      <span className="inline-flex items-center gap-1" title={_('library.memberCountLabel')}>
        <UsersIcon className="h-3.5 w-3.5" />
        <span>{memberCount}</span>
      </span>
    </div>
  )
}
