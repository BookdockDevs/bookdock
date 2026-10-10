import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface SettingsFormFieldProps {
  label: string
  required?: boolean
  error?: string
  className?: string
  as?: 'label' | 'div'
  children: ReactNode
}

export default function SettingsFormField({
  label,
  required = false,
  error,
  className,
  as: Component = 'label',
  children,
}: SettingsFormFieldProps) {
  return (
    <Component className={cn('block min-w-0 text-xs text-stone-500 dark:text-stone-400', className)}>
      <span className="mb-1 block select-none font-normal text-stone-500 dark:text-stone-400">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </Component>
  )
}
