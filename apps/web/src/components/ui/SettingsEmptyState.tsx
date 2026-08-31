import type { ReactNode } from 'react'

interface SettingsEmptyStateProps {
  children: ReactNode
}

export default function SettingsEmptyState({ children }: SettingsEmptyStateProps) {
  return <div className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-400 dark:border-stone-700 dark:text-stone-500">{children}</div>
}
