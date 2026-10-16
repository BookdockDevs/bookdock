import { useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

export interface VisibilityControlLabels {
  private: string
  shared: string
  aria?: string
}

export interface VisibilityControlProps {
  value: 'private' | 'shared'
  onChange: (value: 'private' | 'shared') => void
  canShare?: boolean
  shareHint?: string
  showHintText?: boolean
  disabled?: boolean
  labels?: VisibilityControlLabels
  variant?: 'default' | 'reader'
  order?: ('private' | 'shared')[]
  direction?: 'up' | 'down'
  className?: string
}

function LockIcon({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function GlobeIcon({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20M12 2a14.5 14.5 0 0 1 0 20M2 12h20" />
    </svg>
  )
}

function CheckIcon({ size = 13, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export default function VisibilityControl({
  value,
  onChange,
  canShare = true,
  shareHint,
  showHintText = false,
  disabled = false,
  labels,
  variant = 'default',
  order = variant === 'reader' ? ['shared', 'private'] : ['private', 'shared'],
  direction = 'up',
  className,
}: VisibilityControlProps) {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const resolvedLabels: VisibilityControlLabels = {
    private: labels?.private ?? (variant === 'reader' ? _('annotation.visibilityPrivate') : _('review.visibilityPrivate')),
    shared: labels?.shared ?? (variant === 'reader' ? _('annotation.visibilityPublic') : _('review.visibilityShared')),
    aria: labels?.aria ?? (variant === 'reader' ? _('annotation.visibility') : _('review.visibilityLabel')),
  }

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const isReader = variant === 'reader'

  const triggerClass = isReader
    ? 'flex items-center gap-1.5 rounded-full border border-stone-200/80 bg-stone-500/5 px-2.5 py-1 text-xs text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10 dark:border-stone-800/80 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50'
    : 'flex items-center gap-1.5 rounded-full border border-stone-200/80 bg-stone-500/5 px-2.5 py-1 text-xs text-stone-700 transition-colors hover:bg-stone-500/10 dark:border-stone-800/80 dark:text-stone-300 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50'

  const popoverClass = isReader
    ? 'border-stone-200/80 bg-[var(--bd-read-bg)] text-[var(--bd-read-text)] dark:border-stone-800/80'
    : 'border-stone-200/90 bg-white/95 text-stone-800 shadow-stone-900/10 dark:border-stone-800 dark:bg-stone-900/95 dark:text-stone-100'

  return (
    <div ref={containerRef} className={cn('relative flex items-center gap-1.5 text-xs', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={triggerClass}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value === 'private' ? (
          <LockIcon size={12} className="opacity-80" />
        ) : (
          <GlobeIcon size={12} className="opacity-80" />
        )}
        <span>{value === 'private' ? resolvedLabels.private : resolvedLabels.shared}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={cn('opacity-50 transition-transform duration-200', open && 'rotate-180')}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Screen-reader and automated test support */}
      <select
        aria-label={resolvedLabels.aria}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as 'private' | 'shared')}
        className="sr-only"
        tabIndex={-1}
      >
        <option value="private">{resolvedLabels.private}</option>
        <option value="shared" disabled={!canShare}>{resolvedLabels.shared}</option>
      </select>

      {open && (
        <div
          role="listbox"
          aria-label={resolvedLabels.aria}
          className={cn(
            'absolute z-50 min-w-[130px] rounded-xl border p-1 shadow-xl backdrop-blur-md',
            direction === 'up' ? 'bottom-full mb-1.5 left-0' : 'top-full mt-1.5 left-0',
            popoverClass,
          )}
        >
          {order.map((optKey) => {
            const isSelected = value === optKey
            const isOptDisabled = optKey === 'shared' && !canShare
            const optLabel = optKey === 'private' ? resolvedLabels.private : resolvedLabels.shared

            const itemSelectedClass = isReader
              ? 'bg-[var(--bd-read-primary)]/10 text-[var(--bd-read-primary)] font-medium'
              : 'bg-stone-100 text-stone-900 font-medium dark:bg-stone-800 dark:text-stone-100'

            const itemDefaultClass = isReader
              ? 'text-[var(--bd-read-text)] hover:bg-stone-500/10'
              : 'text-stone-600 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-200'

            const checkColorClass = isReader
              ? 'text-[var(--bd-read-primary)]'
              : 'text-stone-900 dark:text-stone-100'

            return (
              <button
                key={optKey}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={isOptDisabled}
                onClick={() => {
                  if (!isOptDisabled) {
                    onChange(optKey)
                    setOpen(false)
                  }
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors cursor-pointer',
                  isOptDisabled && 'opacity-40 cursor-not-allowed',
                  isSelected ? itemSelectedClass : itemDefaultClass,
                )}
                title={isOptDisabled ? shareHint : undefined}
              >
                {optKey === 'private' ? <LockIcon size={13} /> : <GlobeIcon size={13} />}
                <span>{optLabel}</span>
                {isSelected && <CheckIcon size={13} className={cn('ml-auto', checkColorClass)} />}
              </button>
            )
          })}
        </div>
      )}

      {showHintText && !canShare && shareHint && (
        <span className="text-[11px] text-stone-400">{shareHint}</span>
      )}
    </div>
  )
}
