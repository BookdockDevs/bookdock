import { useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  withinLabel?: boolean
  tone?: 'default' | 'amber'
  className?: string
}

export default function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  disabled,
  label,
  withinLabel = false,
  tone = 'default',
  className,
  id,
  ...props
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  const active = checked || indeterminate
  const Wrapper = withinLabel ? 'span' : 'label'
  const activeToneClass = tone === 'amber'
    ? 'border-amber-600 bg-amber-600 text-white shadow-2xs dark:border-amber-500 dark:bg-amber-500 dark:text-stone-950'
    : 'border-stone-900 bg-stone-900 text-white shadow-2xs dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'

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
          ref={inputRef}
          id={id}
          type="checkbox"
          checked={checked}
          aria-checked={indeterminate ? 'mixed' : checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded border transition-all',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-stone-400 peer-focus-visible:ring-offset-1 dark:peer-focus-visible:ring-offset-stone-900',
            active
              ? activeToneClass
              : 'border-stone-300 bg-white hover:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:hover:border-stone-500',
          )}
        >
          {indeterminate ? (
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
            </svg>
          ) : (
            checked && (
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )
          )}
        </span>
      </span>
      {label && <span>{label}</span>}
    </Wrapper>
  )
}
