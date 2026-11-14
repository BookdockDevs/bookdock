import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { TocRuleRes } from '@bookdock/shared'

import Badge from '@/components/ui/Badge'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { DragHandleIcon, EditIcon, TrashIcon } from './row-icons'

interface TocRuleRowProps {
  rule: TocRuleRes
  disabled: boolean
  sorting: boolean
  onToggle: () => void
  onEdit: () => void
  /** Present only when the row can be deleted; batch delete covers the rest. */
  onDelete?: () => void
  /** False for an instance-published rule: the publisher owns the definition. */
  editable?: boolean
  /** False for a shared rule: batch delete only accepts the caller's own rows. */
  selectable?: boolean
  selected: boolean
  onSelect: () => void
}

export default function TocRuleRow({ rule, disabled, sorting, onToggle, onEdit, onDelete, editable = true, selectable = true, selected, onSelect }: TocRuleRowProps) {
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
      {sorting && selectable && (
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
          <DragHandleIcon />
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
          {/* Scope first so the built-in/custom badge forms a fixed column. */}
          {rule.availability === 'instance' && <Badge>{_('settings.resourceScopeInstance')}</Badge>}
          <Badge>{rule.builtIn ? _('settings.tocRulesBuiltIn') : _('settings.tocRulesCustom')}</Badge>
          <div className="flex shrink-0 items-center gap-1">
            <Toggle checked={rule.enabled} onChange={onToggle} disabled={disabled} ariaLabel={rule.name || _('settings.tocRulesEnabled')} />
          </div>
        </>
      )}

      {sorting && editable && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            aria-label={_('settings.tocRulesEditShort')}
            title={_('settings.tocRulesEditShort')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <EditIcon />
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={disabled}
              aria-label={_('settings.ruleDelete')}
              title={_('settings.ruleDelete')}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/40"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      )}
    </li>
  )
}
