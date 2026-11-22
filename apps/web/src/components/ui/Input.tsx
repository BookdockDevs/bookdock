import type { InputHTMLAttributes, Ref } from 'react'

import { cn } from '@/lib/utils'

export const inputBaseClass =
  'w-full rounded-lg border border-(--bd-field-border) bg-(--bd-field-bg) text-(--bd-field-text) outline-none transition-colors placeholder:text-(--bd-hint-text) focus:border-(--bd-field-focus-border) disabled:cursor-not-allowed disabled:opacity-50'

const inputSizes = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-2.5 text-sm',
} as const

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md'
  invalid?: boolean
  ref?: Ref<HTMLInputElement>
}

export default function Input({
  size = 'md',
  invalid = false,
  className,
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps) {
  const isInvalid = invalid || ariaInvalid === true || ariaInvalid === 'true'
  return (
    <input
      {...props}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      className={cn(
        inputBaseClass,
        inputSizes[size],
        isInvalid && 'border-red-500 focus:border-red-500 dark:border-red-400 dark:focus:border-red-400',
        className,
      )}
    />
  )
}
