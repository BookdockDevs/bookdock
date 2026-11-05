import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { DictionaryItem } from '@bookdock/shared'

import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { cn, formatBytes } from '@/lib/utils'

interface DictionaryRowProps {
  item: DictionaryItem
  isOwner: boolean
  editing: boolean
  disabled: boolean
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

export default function DictionaryRow({ item, isOwner, editing, disabled, onToggle, onEdit, onDelete }: DictionaryRowProps) {
  const _ = useTranslation()
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !editing || disabled,
    animateLayoutChanges: () => false,
  })
  const canDelete = item.mine || isOwner
  const badge = 'inline-flex shrink-0 rounded border border-stone-200 px-1.5 py-0.5 text-[10px] text-stone-400 dark:border-stone-700'

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border border-stone-200/80 bg-stone-50/50 px-3 py-2.5 transition-all dark:border-stone-800/80 dark:bg-stone-900/40',
        !item.enabled && 'opacity-60 bg-transparent dark:bg-transparent',
        isDragging && 'relative z-10 opacity-70 shadow-md ring-1 ring-stone-400/30',
      )}
    >
      {editing && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={_('dictionary.reorder', { name: item.name })}
          title={_('dictionary.reorder', { name: item.name })}
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
        <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100" title={item.name}>
          {item.name}
        </p>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <span className={badge}>
            MDX
          </span>
          {item.scope === 'instance' && (
            <span className={badge}>
              {_('settings.fontsScopeInstance')}
            </span>
          )}
          {item.fileNames.length > 1 && (
            <span className={badge}>
              {_('dictionary.withResources')}
            </span>
          )}
          <span className="tabular-nums">{formatBytes(item.size)}</span>
        </div>
      </div>

      {!editing ? (
        <div className="flex shrink-0 items-center gap-1">
          <Toggle checked={item.enabled} ariaLabel={item.name} disabled={disabled} onChange={onToggle} />
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={_('dictionary.edit')}
            title={_('dictionary.edit')}
            disabled={disabled}
            onClick={onEdit}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <EditIcon />
          </button>
          {canDelete && (
            <button
              type="button"
              aria-label={_('dictionary.delete', { name: item.name })}
              title={_('dictionary.delete', { name: item.name })}
              disabled={disabled}
              onClick={onDelete}
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
