import type { ReactNode } from 'react'

import type { ReadStatus } from '@bookdock/shared'

export const STATUS_DOT: Record<ReadStatus, string> = {
  wishlist: 'bg-violet-500',
  reading: 'bg-blue-500',
  idle: 'bg-stone-400 dark:bg-stone-500',
  finished: 'bg-emerald-500',
  abandoned: 'bg-amber-500',
}

export interface ReadStatusOption {
  value: ReadStatus
  labelKey: string
  iconClass: string
  icon: ReactNode
}

export const READ_STATUS_OPTIONS: ReadStatusOption[] = [
  { value: 'wishlist', labelKey: 'library.readStatusWishlist', iconClass: 'text-violet-500', icon: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /> },
  { value: 'reading', labelKey: 'library.readStatusReading', iconClass: 'text-blue-500', icon: <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></> },
  { value: 'finished', labelKey: 'library.readStatusFinished', iconClass: 'text-emerald-500', icon: <><circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" /></> },
  { value: 'idle', labelKey: 'library.readStatusIdle', iconClass: 'text-stone-500', icon: <><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></> },
  { value: 'abandoned', labelKey: 'library.readStatusAbandoned', iconClass: 'text-amber-500', icon: <><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></> },
]

export function statusLabelKey(status: ReadStatus): string {
  return READ_STATUS_OPTIONS.find((o) => o.value === status)!.labelKey
}
