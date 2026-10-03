import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { TocRuleRes } from '@bookdock/shared'

import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

interface TocRuleRowProps {
  rule: TocRuleRes
  disabled: boolean
  sorting: boolean
  onToggle: () => void
  onEdit: () => void
  selected: boolean
  onSelect: () => void
}

export default function TocRuleRow({ rule, disabled, sorting, onToggle, onEdit, selected, onSelect }: TocRuleRowProps) {
  const _ = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
    animateLayoutChanges: () => false,
  })
  const patterns = rule.patterns
    .slice()
    .sort((a, b) => a.level - b.level)

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn('flex items-center gap-3 py-2.5', !sorting && !rule.enabled && 'opacity-60', isDragging && 'relative z-10 opacity-60')}
    >
      {sorting && (
        <input type="checkbox" checked={selected} onChange={onSelect} disabled={disabled}
          aria-label={_('settings.ruleSelect', { name: rule.name })}
          className="h-4 w-4 shrink-0 accent-stone-700 dark:accent-stone-300" />
      )}
      {sorting && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={_('settings.tocRulesReorder')}
          title={_('settings.tocRulesReorder')}
          className="flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
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
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {rule.name || '—'}
        </p>
        {patterns.length > 0 && (
          <p className="mt-0.5 truncate text-[11px] font-medium tracking-wide text-stone-400 dark:text-stone-500">
            {patterns.map((pattern, index) => <span key={pattern.level}>{index > 0 && ' · '}L{pattern.level}</span>)}
          </p>
        )}
      </div>

      {!sorting && (
        <>
          <span className="inline-flex shrink-0 rounded border border-stone-200 px-1.5 py-0.5 text-[10px] text-stone-400 dark:border-stone-700">
            {rule.builtIn ? _('settings.tocRulesBuiltIn') : _('settings.tocRulesCustom')}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Toggle checked={rule.enabled} onChange={onToggle} disabled={disabled} ariaLabel={rule.name || _('settings.tocRulesEnabled')} />
          </div>
        </>
      )}

      {sorting && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            aria-label={_('settings.tocRulesEditShort')}
            title={_('settings.tocRulesEditShort')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>

        </div>
      )}
    </li>
  )
}
