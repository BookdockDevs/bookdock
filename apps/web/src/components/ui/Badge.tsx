import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface BadgeProps {
  className?: string
  children: ReactNode
}

export default function Badge({ className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded border border-stone-200 px-1.5 py-0.5 text-[10px] text-stone-400 dark:border-stone-700',
        className,
      )}
    >
      {children}
    </span>
  )
}
