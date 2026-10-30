import type { InputHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  className?: string
}

export default function Checkbox({ checked, onChange, disabled, label, className, id, ...props }: CheckboxProps) {
  return (
    <label
      htmlFor={id}
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
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded border transition-all',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/30 peer-focus-visible:ring-offset-1',
            checked
              ? 'border-blue-600 bg-blue-600 text-white shadow-2xs dark:border-blue-500 dark:bg-blue-500'
              : 'border-stone-300 bg-white hover:border-stone-400 dark:border-stone-600 dark:bg-stone-850 dark:hover:border-stone-500',
          )}
        >
          {checked && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-white animate-in zoom-in-75 duration-100"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
      </span>
      {label && <span>{label}</span>}
    </label>
  )
}
