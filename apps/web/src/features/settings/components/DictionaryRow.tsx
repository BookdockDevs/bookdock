import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { DictionaryItem } from '@bookdock/shared'

import Badge from '@/components/ui/Badge'
import Checkbox from '@/components/ui/Checkbox'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { DragHandleIcon, EditIcon, TrashIcon } from './row-icons'

interface DictionaryRowProps {
  item: DictionaryItem
  isOwner: boolean
  editing: boolean
  disabled: boolean
  selected?: boolean
  onSelectChange?: (checked: boolean) => void
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

export default function DictionaryRow({
  item,
  isOwner,
  editing,
  disabled,
  selected = false,
  onSelectChange,
  onToggle,
  onEdit,
  onDelete,
}: DictionaryRowProps) {
  const _ = useTranslation()
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !editing || disabled,
    animateLayoutChanges: () => false,
  })
  const canDelete = item.mine || isOwner

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border border-stone-200/80 bg-stone-50/50 px-3 py-2.5 transition-[background-color,border-color,opacity,box-shadow] dark:border-stone-800/80 dark:bg-stone-900/40',
        !item.enabled && 'opacity-60 bg-transparent dark:bg-transparent',
        isDragging && 'relative z-10 opacity-70 shadow-md ring-1 ring-stone-400/30',
      )}
    >
      {editing && (
        <Checkbox
          checked={selected}
          disabled={disabled}
          aria-label={item.name}
          onChange={(checked) => onSelectChange?.(checked)}
          className="shrink-0"
        />
      )}
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
          <DragHandleIcon />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100" title={item.name}>
          {item.name}
        </p>
      </div>

      {!editing ? (
        <>
          {item.scope === 'instance' && <Badge>{_('settings.resourceScopeInstance')}</Badge>}
          {item.fileNames.length > 1 && <Badge>{_('dictionary.withResources')}</Badge>}
          <div className="flex shrink-0 items-center gap-1">
            <Toggle checked={item.enabled} ariaLabel={item.name} disabled={disabled} onChange={onToggle} />
          </div>
        </>
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
