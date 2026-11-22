import type { InputHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean
  onChange: () => void
  label?: ReactNode
  withinLabel?: boolean
  className?: string
}

export default function Radio({
  checked,
  onChange,
  disabled,
  label,
  withinLabel = false,
  className,
  id,
  ...props
}: RadioProps) {
  const Wrapper = withinLabel ? 'span' : 'label'

  return (
    <Wrapper
      {...(!withinLabel && id ? { htmlFor: id } : {})}
      className={cn(
        'inline-flex items-center gap-2 select-none text-xs font-medium transition-colors',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer text-stone-700 dark:text-stone-300',
        className,
      )}
    >
      <span className="relative flex items-center justify-center">
        <input
          {...props}
          id={id}
          type="radio"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full border transition-all',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-stone-400 peer-focus-visible:ring-offset-1 dark:peer-focus-visible:ring-offset-stone-900',
            checked
              ? 'border-stone-900 bg-stone-900 text-white shadow-2xs dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
              : 'border-stone-300 bg-white hover:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:hover:border-stone-500',
          )}
        >
          {checked && <span className="size-1.5 rounded-full bg-current" />}
        </span>
      </span>
      {label && <span>{label}</span>}
    </Wrapper>
  )
}
