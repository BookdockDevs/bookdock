import { useRef, useLayoutEffect, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface TaxonomyChoiceRowProps {
  label: string
  ariaLabel?: string
  checked: boolean | 'mixed'
  onChange: () => void
  type?: 'radio' | 'checkbox'
  name?: string
  count?: ReactNode
  disabled?: boolean
}

export default function TaxonomyChoiceRow({ label, ariaLabel, checked, onChange, type = 'radio', name, count, disabled = false }: TaxonomyChoiceRowProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = checked === 'mixed'
  }, [checked])

  return (
    <label className={cn('relative flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-stone-100/70 dark:hover:bg-stone-800', checked === true ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100' : 'text-stone-600 dark:text-stone-300')}>
      <input ref={inputRef} type={type} name={name} aria-label={ariaLabel} checked={checked === true} aria-checked={checked} disabled={disabled} onChange={onChange} className="peer sr-only top-1/2 left-2.5 -translate-y-1/2" />
      <span aria-hidden="true" className={cn('flex h-4 w-4 shrink-0 items-center justify-center border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-stone-400 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-stone-900', type === 'radio' ? 'rounded-full' : 'rounded', checked ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900' : 'border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-900')}>
        {checked === 'mixed' ? <span className="h-0.5 w-2 rounded-full bg-current" /> : checked && (type === 'radio' ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>)}
      </span>
      <span className="min-w-0 flex-1 truncate" title={ariaLabel ?? label}>{label}</span>
      {count !== undefined && <span className="shrink-0 text-xs tabular-nums text-stone-400 dark:text-stone-500">{count}</span>}
    </label>
  )
}
