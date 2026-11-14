import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { AiPromptTemplate } from '@bookdock/shared'

import Badge from '@/components/ui/Badge'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { DragHandleIcon, EditIcon, TrashIcon } from './row-icons'

interface AiPromptRowProps {
  prompt: AiPromptTemplate
  disabled: boolean
  sorting: boolean
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

export default function AiPromptRow({ prompt, disabled, sorting, onToggle, onEdit, onDelete }: AiPromptRowProps) {
  const _ = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: prompt.id,
    animateLayoutChanges: () => false,
  })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-3 py-2.5', !prompt.enabled && 'opacity-60', isDragging && 'relative z-10 opacity-60')}
    >
      {sorting && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={_('settings.aiPromptReorder')}
          title={_('settings.aiPromptReorder')}
          className="flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <DragHandleIcon />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs">
          {prompt.name}
        </p>
        <p className="truncate text-[11px] text-stone-400">
          {prompt.prompt}
        </p>
      </div>

      {!sorting && (
        <>
          {/* Scope first so the built-in/custom badge forms a fixed column. */}
          {prompt.availability === 'instance' && (
            <Badge>
              {_('settings.resourceScopeInstance')}
            </Badge>
          )}
          <Badge>
            {prompt.builtIn ? _('settings.aiPromptBuiltIn') : _('settings.aiPromptCustom')}
          </Badge>
          <div className="flex shrink-0 items-center gap-1">
            <Toggle checked={prompt.enabled} onChange={onToggle} disabled={disabled} ariaLabel={prompt.name} />
          </div>
        </>
      )}

      {sorting && (
        <div className="flex shrink-0 items-center gap-1">
          {prompt.mine && (
            <button type="button" onClick={onEdit} disabled={disabled} aria-label={_('settings.aiEdit')} title={_('settings.aiEdit')} className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200">
              <EditIcon />
            </button>
          )}
          {prompt.mine && (
            <button type="button" onClick={onDelete} disabled={disabled} aria-label={_('settings.aiPromptDelete')} title={_('settings.aiPromptDelete')} className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40">
              <TrashIcon />
            </button>
          )}
        </div>
      )}
    </li>
  )
}
