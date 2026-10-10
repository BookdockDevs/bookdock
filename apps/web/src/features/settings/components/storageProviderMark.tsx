import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface StorageProviderMeta {
  label: string
  badge: ReactNode
  mark: ReactNode
  tileClassName: string
}

export function LocalStorageBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] min-w-[28px] items-center justify-center rounded border border-stone-200/70 bg-stone-100 px-1 text-stone-600 dark:border-stone-700/70 dark:bg-stone-800 dark:text-stone-400',
        className,
      )}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <line x1="8" x2="16" y1="21" y2="21" />
        <line x1="12" x2="12" y1="17" y2="21" />
      </svg>
    </span>
  )
}

// Visual badges and brand tiles per storage provider.
// WebDAV features the iconic high-contrast slanted DAV mark popular in modern media players/NAS tools,
// while S3 sports an authentic cloud-storage ocean blue badge.
export const PROVIDER_MARK: Record<string, StorageProviderMeta> = {
  webdav: {
    label: 'WebDAV',
    badge: (
      <span className="inline-flex h-[18px] min-w-[28px] items-center justify-center rounded border border-stone-200/90 bg-stone-100 px-1 text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
        <span className="-translate-x-px text-[10px] font-black italic leading-none tracking-tighter">
          DAV
        </span>
      </span>
    ),
    mark: (
      <span className="-translate-x-px text-[11px] font-black italic leading-none tracking-tighter">
        DAV
      </span>
    ),
    tileClassName:
      'bg-zinc-900 text-zinc-100 border border-zinc-950/20 shadow-xs dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700/80',
  },
  s3: {
    label: 'S3',
    badge: (
      <span className="inline-flex h-[18px] min-w-[28px] items-center justify-center rounded border border-sky-200/90 bg-sky-50 px-1 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
        <span className="text-[10px] font-black leading-none tracking-tight">
          S3
        </span>
      </span>
    ),
    mark: (
      <span className="text-[11px] font-black leading-none tracking-tight">
        S3
      </span>
    ),
    tileClassName:
      'bg-sky-600 text-white border border-sky-700/30 shadow-xs dark:bg-sky-500 dark:text-white dark:border-sky-400/20',
  },
}

