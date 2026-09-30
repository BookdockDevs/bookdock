import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export const inputClass =
  'h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-700 outline-none transition-all placeholder:text-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-400/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500 dark:focus:ring-stone-500/20'

export const textareaClass =
  'w-full resize-none overflow-hidden rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm leading-relaxed text-stone-700 outline-none transition-all placeholder:text-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-400/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500 dark:focus:ring-stone-500/20'

export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
      {children}
    </p>
  )
}

export function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-stone-500 dark:text-stone-400">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  )
}

export function Chip({
  label,
  selected,
  showCheck = false,
  onClick,
}: {
  label: string
  selected: boolean
  showCheck?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        selected
          ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
          : 'border border-stone-200 bg-white/60 text-stone-600 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-100'
      }`}
    >
      {showCheck && selected && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 -ml-0.5">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      <span>{label}</span>
    </button>
  )
}

export function FilterChip({
  label,
  prefix,
  muted = false,
  onClick,
}: {
  label: string
  prefix?: string
  muted?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
        muted
          ? 'border border-dashed border-stone-300 text-stone-400 hover:border-stone-400 hover:text-stone-600 dark:border-stone-600 dark:hover:border-stone-500 dark:hover:text-stone-300'
          : 'bg-stone-100/90 text-stone-600 hover:bg-stone-200/90 hover:text-stone-900 dark:bg-stone-800/90 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100'
      }`}
    >
      {prefix && <span aria-hidden="true" className="opacity-60 font-mono text-[11px]">{prefix}</span>}
      <span>{label}</span>
    </button>
  )
}

export function ActionIcon({
  label,
  danger = false,
  secondary = false,
  disabled = false,
  onClick,
  title,
  children,
}: {
  label: string
  danger?: boolean
  secondary?: boolean
  disabled?: boolean
  /** Omitted for an inert icon; `title` then carries the explanation. */
  onClick?: () => void
  /** Hover explanation; defaults to the label. */
  title?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'text-stone-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400'
          : secondary
            ? 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100'
            : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200'
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}

/** Row-level expand/collapse for long metadata values (file names, subjects). */
export function RowExpandButton({ expanded, label, onToggle }: { expanded: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      title={label}
      aria-label={label}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200"
    >
      <svg
        className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  )
}

/**
 * A long metadata value with overflow-gated expansion. The chevron renders
 * only when the clamped content actually overflows (or while expanded), so
 * single-line values never grow a useless affordance. Copyable rows copy on
 * value click; plain rows toggle on value click.
 */
export function ExpandableRowValue({
  value,
  mono = false,
  wrapClass = 'break-all',
  textClass = 'text-sm',
  onCopy,
  copyHint,
  expandLabel,
  collapseLabel,
}: {
  value: string
  mono?: boolean
  wrapClass?: string
  textClass?: string
  onCopy?: () => void
  copyHint?: string
  expandLabel: string
  collapseLabel: string
}) {
  const [expanded, setExpanded] = useState(false)
  const textRef = useRef<HTMLButtonElement | null>(null)
  const [overflowed, setOverflowed] = useState(false)
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el || expanded) return
    const measure = () => {
      const next = el.scrollHeight > el.clientHeight + 1
      setOverflowed((prev) => (prev === next ? prev : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  })
  const label = expanded ? collapseLabel : expandLabel
  const toggle = () => setExpanded((prev) => !prev)
  return (
    <div className="flex max-w-full items-start gap-1">
      <button
        ref={textRef}
        type="button"
        title={onCopy ? (copyHint ?? value) : undefined}
        onClick={onCopy ?? toggle}
        aria-expanded={onCopy ? undefined : expanded}
        className={
          `min-w-0 flex-1 cursor-pointer text-left ${textClass} text-stone-700 dark:text-stone-200`
          + (mono ? ' font-mono' : '')
          + (onCopy && !expanded ? ' hover:underline' : '')
          + (expanded ? ` whitespace-pre-wrap ${wrapClass}` : ` line-clamp-2 ${wrapClass}`)
        }
      >
        {value}
      </button>
      {(expanded || overflowed) && (
        <RowExpandButton expanded={expanded} label={label} onToggle={toggle} />
      )}
    </div>
  )
}
