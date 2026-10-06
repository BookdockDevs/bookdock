import { useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { CheckIcon, LockIcon } from './annotation-icons'

interface IdeaVisibilityControlProps {
  value: 'private' | 'shared'
  onChange: (value: 'private' | 'shared') => void
  sourceReadable: boolean
  disabled?: boolean
}

function GlobeIcon({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20M12 2a14.5 14.5 0 0 1 0 20M2 12h20" />
    </svg>
  )
}

export default function IdeaVisibilityControl({ value, onChange, sourceReadable, disabled }: IdeaVisibilityControlProps) {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={containerRef} className="relative flex items-center gap-1.5 text-xs text-[var(--bd-read-sub)]">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-full border border-stone-200/80 bg-stone-500/5 px-2.5 py-1 text-xs text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10 dark:border-stone-800/80 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      >
        {value === 'private' ? <LockIcon size={12} className="opacity-80" /> : <GlobeIcon size={12} className="opacity-80" />}
        <span>{value === 'private' ? _('annotation.visibilityPrivate') : _('annotation.visibilityPublic')}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={cn('opacity-50 transition-transform duration-200', open && 'rotate-180')}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Screen-reader and automated test support */}
      <select
        aria-label={_('annotation.visibility')}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as 'private' | 'shared')}
        className="sr-only"
        tabIndex={-1}
      >
        <option value="shared" disabled={!sourceReadable}>{_('annotation.visibilityPublic')}</option>
        <option value="private">{_('annotation.visibilityPrivate')}</option>
      </select>

      {open && (
        <div
          role="listbox"
          aria-label={_('annotation.visibility')}
          className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[120px] rounded-xl border border-stone-200/80 bg-[var(--bd-read-bg)] p-1 shadow-xl backdrop-blur-md dark:border-stone-800/80"
        >
          <button
            type="button"
            role="option"
            aria-selected={value === 'shared'}
            disabled={!sourceReadable}
            onClick={() => {
              if (sourceReadable) {
                onChange('shared')
                setOpen(false)
              }
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors cursor-pointer',
              !sourceReadable && 'opacity-40 cursor-not-allowed',
              value === 'shared'
                ? 'bg-blue-500/10 text-blue-500 font-medium'
                : 'text-[var(--bd-read-text)] hover:bg-stone-500/10',
            )}
            title={!sourceReadable ? _('annotation.visibilitySourceUnavailable') : undefined}
          >
            <GlobeIcon size={13} />
            <span>{_('annotation.visibilityPublic')}</span>
            {value === 'shared' && <CheckIcon size={13} className="ml-auto text-blue-500" />}
          </button>

          <button
            type="button"
            role="option"
            aria-selected={value === 'private'}
            onClick={() => {
              onChange('private')
              setOpen(false)
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors cursor-pointer',
              value === 'private'
                ? 'bg-blue-500/10 text-blue-500 font-medium'
                : 'text-[var(--bd-read-text)] hover:bg-stone-500/10',
            )}
          >
            <LockIcon size={13} />
            <span>{_('annotation.visibilityPrivate')}</span>
            {value === 'private' && <CheckIcon size={13} className="ml-auto text-blue-500" />}
          </button>
        </div>
      )}

      {!sourceReadable && <span className="text-[11px] text-stone-400">{_('annotation.visibilitySourceUnavailable')}</span>}
    </div>
  )
}
