import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface SettingsFormFieldProps {
  label: string
  required?: boolean
  error?: string
  className?: string
  as?: 'label' | 'div'
  /** Small control pinned to the right end of the label row (e.g. a toggle) */
  labelExtra?: ReactNode
  /** Control id to label explicitly. Required together with labelExtra: an
   *  extra control inside the implicit <label> would capture the label
   *  association from the field itself (first labelable descendant wins). */
  labelFor?: string
  children: ReactNode
}

export default function SettingsFormField({
  label,
  required = false,
  error,
  className,
  as: Component = 'label',
  labelExtra,
  labelFor,
  children,
}: SettingsFormFieldProps) {
  const labelText = (
    <>
      {label}
      {required && <span className="text-red-500"> *</span>}
    </>
  )
  const field = (
    <>
      <span className="mb-1 flex select-none items-center justify-between gap-2 font-normal text-(--bd-label-text)">
        {labelFor ? <label htmlFor={labelFor}>{labelText}</label> : <span>{labelText}</span>}
        {labelExtra}
      </span>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </>
  )
  if (labelFor) {
    return <div className={cn('block min-w-0 text-xs text-(--bd-label-text)', className)}>{field}</div>
  }
  return (
    <Component className={cn('block min-w-0 text-xs text-(--bd-label-text)', className)}>{field}</Component>
  )
}
