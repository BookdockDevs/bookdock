import { useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react'

import SmartMenu from '@/components/ui/SmartMenu'
import type { MenuAnchor } from '@/lib/menu-anchor'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md'
  variant?: 'default' | 'reader'
  containerClassName?: string
  chevronClassName?: string
  minMenuWidth?: number
  options?: SelectOption[]
  placeholder?: string
  onValueChange?: (value: string) => void
}

export default function Select({
  size = 'sm',
  variant = 'default',
  className,
  containerClassName,
  chevronClassName,
  minMenuWidth = 160,
  options,
  placeholder,
  value,
  onValueChange,
  onChange,
  disabled,
  id,
  'aria-label': ariaLabel,
  children,
  ...props
}: SelectProps) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  if (!options) {
    return (
      <span className={cn('relative inline-flex items-center', containerClassName)}>
        <select
          {...props}
          id={id}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={onChange}
          className={cn(
            'w-full appearance-none border border-stone-200 bg-white text-stone-700 outline-none transition-colors',
            'hover:border-stone-300 focus-visible:border-stone-400 focus-visible:ring-2 focus-visible:ring-stone-400/25',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-600',
            size === 'md' ? 'h-8 rounded-lg pl-2.5 pr-8 text-xs' : 'h-7 rounded-md pl-2 pr-7 text-xs',
            className,
          )}
        >
          {children}
        </select>
        <ChevronDown />
      </span>
    )
  }

  const currentValue = value === undefined ? '' : String(value)
  const selectedOption = options.find((opt) => opt.value === currentValue)
  const triggerWidth = triggerRef.current?.getBoundingClientRect().width ?? 0
  const menuWidth = triggerWidth > 0 ? Math.max(triggerWidth, minMenuWidth) : (minMenuWidth > 0 ? minMenuWidth : 'auto')
  const estimatedHeight = Math.min(options.length * 32 + 12, 252)

  function toggleMenu() {
    if (disabled) return
    if (menu) {
      setMenu(null)
      return
    }
    const el = triggerRef.current
    if (!el) return
    setMenu({ kind: 'element', el, placement: 'below', align: 'start' })
  }

  function handleSelect(nextValue: string) {
    setMenu(null)
    onValueChange?.(nextValue)
  }

  return (
    <span className={cn('relative inline-flex items-center', containerClassName)}>
      {/* Native select kept visually hidden for <label htmlFor>, screen readers, and test compatibility */}
      <select
        {...props}
        id={id}
        value={currentValue}
        disabled={disabled}
        aria-label={ariaLabel}
        tabIndex={-1}
        onChange={(e) => {
          onChange?.(e)
          onValueChange?.(e.target.value)
        }}
        className="sr-only"
      >
        {placeholder && !selectedOption && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={Boolean(menu)}
        aria-label={ariaLabel}
        onClick={toggleMenu}
        className={cn(
          'flex w-full items-center justify-between gap-2 outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          variant === 'reader'
            ? 'border-0 bg-transparent text-current hover:bg-stone-500/10 focus-visible:bg-stone-500/10 focus-visible:ring-1 focus-visible:ring-current/40'
            : 'border border-stone-200 bg-white text-left text-stone-700 hover:border-stone-300 focus-visible:border-stone-400 focus-visible:ring-2 focus-visible:ring-stone-400/25 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-600',
          size === 'md' ? 'h-8 rounded-lg pl-2.5 pr-7 text-xs' : 'h-7 rounded-md pl-2 pr-7 text-xs',
          className,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selectedOption && 'text-stone-400 dark:text-stone-500')}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
      </button>
      <ChevronDown className={chevronClassName} />

      {menu && (
        <SmartMenu
          innerRef={menuRef}
          triggerRef={triggerRef}
          anchor={menu}
          variant={variant}
          size={{ width: menuWidth, height: estimatedHeight }}
          minWidth={minMenuWidth}
          maxWidth={360}
          onClose={() => setMenu(null)}
          className="max-h-60 overflow-y-auto p-1"
        >
          <div role="listbox" aria-label={ariaLabel} className="flex flex-col gap-0.5">
            {options.map((opt) => {
              const isSelected = opt.value === currentValue
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onClick={() => handleSelect(opt.value)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                    variant === 'reader'
                      ? (isSelected
                        ? 'bg-stone-500/15 font-medium text-current'
                        : 'text-current/80 hover:bg-stone-500/10 hover:text-current')
                      : (isSelected
                        ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                        : 'text-stone-600 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800/70 dark:hover:text-stone-100'),
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  {isSelected && <CheckIcon variant={variant} />}
                </button>
              )
            })}
          </div>
        </SmartMenu>
      )}
    </span>
  )
}

function ChevronDown({ className }: { className?: string }): ReactNode {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('pointer-events-none absolute right-2 text-stone-400 dark:text-stone-500', className)}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function CheckIcon({ variant = 'default' }: { variant?: 'default' | 'reader' }): ReactNode {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0', variant === 'reader' ? 'text-current' : 'text-stone-900 dark:text-stone-100')}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
