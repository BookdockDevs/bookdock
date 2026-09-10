import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface SettingsFormFieldProps {
  label: string
  required?: boolean
  error?: string
  className?: string
  children: ReactNode
}

export default function SettingsFormField({ label, required = false, error, className, children }: SettingsFormFieldProps) {
  return (
    <label className={cn('block min-w-0 text-xs text-stone-400 dark:text-stone-500', className)}>
      <span className="mb-1 block">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </label>
  )
}
