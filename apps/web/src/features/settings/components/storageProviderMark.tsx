import type { ReactNode } from 'react'

export interface StorageProviderMeta {
  label: string
  badge: ReactNode
  mark: ReactNode
  tileClassName: string
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

