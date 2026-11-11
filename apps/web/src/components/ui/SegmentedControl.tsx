import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: ReactNode
  title?: string
  disabled?: boolean
}

interface SegmentedControlBaseProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  ariaLabel?: string
  ariaLabelledBy?: string
  disabled?: boolean
  pending?: boolean
  size?: 'sm' | 'md'
  fullWidth?: boolean
  wrap?: boolean
  className?: string
}

type SegmentedControlProps<T extends string = string> = SegmentedControlBaseProps<T> & (
  | {
      multiple?: false
      value: T | null | undefined
      onChange: (value: T) => void
      role?: 'group' | 'radiogroup'
    }
  | {
      multiple: true
      value: readonly T[]
      onChange: (value: T) => void
      role?: 'group'
    }
)

export default function SegmentedControl<T extends string = string>({
  options,
  ariaLabel,
  ariaLabelledBy,
  disabled = false,
  pending = false,
  size = 'sm',
  fullWidth = false,
  wrap = false,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const isMultiple = rest.multiple === true
  const groupRole = isMultiple ? 'group' : (rest.role ?? 'group')

  return (
    <div
      role={groupRole}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-busy={pending}
      className={cn(
        fullWidth ? 'flex w-full' : 'inline-flex w-fit shrink-0',
        wrap && 'flex-wrap',
        'items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800',
        className,
      )}
    >
      {options.map((opt) => {
        const selected = isMultiple
          ? rest.value.includes(opt.value)
          : rest.value === opt.value
        const isDisabled = disabled || opt.disabled === true

        const a11yProps = isMultiple
          ? { role: 'checkbox' as const, 'aria-checked': selected }
          : groupRole === 'radiogroup'
            ? { role: 'radio' as const, 'aria-checked': selected }
            : { 'aria-pressed': selected }

        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            disabled={isDisabled || pending}
            onClick={() => rest.onChange(opt.value)}
            {...a11yProps}
            className={cn(
              'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-all select-none disabled:cursor-not-allowed',
              isDisabled && 'opacity-50',
              size === 'md' ? 'h-8 px-3 text-xs' : 'h-7 px-2.5 text-xs',
              fullWidth && 'min-w-0 flex-1',
              selected
                ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-700 dark:text-stone-100'
                : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
