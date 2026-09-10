import type { Ref } from 'react'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import SettingsFormField from './SettingsFormField'
import { settingsInputClass } from './settingsForm'

export type TocPatternError = 'required' | 'invalidRegex' | null

interface TocPatternRowProps {
  id: string
  level: number
  regex: string
  replacement: string
  error: TocPatternError
  disabled: boolean
  canRemove: boolean
  inputRef?: Ref<HTMLInputElement>
  onChange: (patch: { regex?: string; replacement?: string }) => void
  onRemove: () => void
}

export default function TocPatternRow({ id, level, regex, replacement, error, disabled, canRemove, inputRef, onChange, onRemove }: TocPatternRowProps) {
  const _ = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: () => false,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700', isDragging && 'relative z-10 opacity-60')}
    >
      <div className="flex items-center gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2.5 dark:border-stone-700 dark:bg-stone-800/60">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={_('settings.tocRulesReorder')}
          title={_('settings.tocRulesReorder')}
          className="flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-700 dark:hover:text-stone-200"
        >
          <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="3" r="1.3" />
            <circle cx="10" cy="3" r="1.3" />
            <circle cx="4" cy="9" r="1.3" />
            <circle cx="10" cy="9" r="1.3" />
            <circle cx="4" cy="15" r="1.3" />
            <circle cx="10" cy="15" r="1.3" />
          </svg>
        </button>
        <span className="min-w-0 flex-1 text-xs font-medium text-stone-700 dark:text-stone-200">
          {_('settings.tocRulesLevel')} {level}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled || !canRemove}
          aria-label={_('settings.tocRulesRemovePattern')}
          title={_('settings.tocRulesRemovePattern')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M19 6v14c0 1-2 2-2 2H7a2 2 0 0 1-2-2V6M8 6V4c0-1 2-2 2-2h4c1 0 2 2 2 2v2" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <SettingsFormField
          label={_('settings.tocRulesRegex')}
          required
          error={error === 'required' ? _('settings.tocRulesPatternRequired') : error === 'invalidRegex' ? _('settings.tocRulesRegexInvalid') : undefined}
        >
          <input
            ref={inputRef}
            type="text"
            value={regex}
            onChange={(event) => onChange({ regex: event.target.value })}
            disabled={disabled}
            aria-invalid={error !== null || undefined}
            className={cn(settingsInputClass, 'font-mono')}
          />
        </SettingsFormField>

        <SettingsFormField label={_('settings.tocRulesReplacement')}>
          <input
            type="text"
            value={replacement}
            onChange={(event) => onChange({ replacement: event.target.value })}
            disabled={disabled}
            placeholder={_('settings.tocRulesReplacementPlaceholder')}
            className={settingsInputClass}
          />
        </SettingsFormField>
      </div>
    </div>
  )
}
