import type { Ref, TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export const textareaBaseClass =
  'w-full resize-none rounded-lg border border-(--bd-field-border) bg-(--bd-field-bg) px-2.5 py-2 text-sm leading-relaxed text-(--bd-field-text) outline-none transition-colors placeholder:text-(--bd-hint-text) focus:border-(--bd-field-focus-border) disabled:cursor-not-allowed disabled:opacity-50'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
  ref?: Ref<HTMLTextAreaElement>
}

export default function Textarea({
  invalid = false,
  className,
  'aria-invalid': ariaInvalid,
  ...props
}: TextareaProps) {
  const isInvalid = invalid || ariaInvalid === true || ariaInvalid === 'true'
  return (
    <textarea
      {...props}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      className={cn(
        textareaBaseClass,
        isInvalid && 'border-red-500 focus:border-red-500 dark:border-red-400 dark:focus:border-red-400',
        className,
      )}
    />
  )
}
