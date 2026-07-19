import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className={cn('min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100')}>
      {children}
    </div>
  )
}
