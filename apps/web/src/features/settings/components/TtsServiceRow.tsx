import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { TtsServiceRes } from '@bookdock/shared'

import Badge from '@/components/ui/Badge'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import TtsProviderIcon from './TtsProviderIcon'
import { DragHandleIcon, EditIcon, TrashIcon } from './row-icons'

interface TtsServiceRowProps {
  service: TtsServiceRes
  editing: boolean
  disabled: boolean
  /** Consumers may switch their own service on or off but never edit or delete it. */
  canEdit: boolean
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

export default function TtsServiceRow({ service, editing, disabled, canEdit, onToggle, onEdit, onDelete }: TtsServiceRowProps) {
  const _ = useTranslation()
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: service.id,
    disabled: !editing || disabled,
    animateLayoutChanges: () => false,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2.5 py-3 transition-[background-color,border-color,opacity,box-shadow]',
        !service.enabled && 'opacity-60',
        isDragging && 'relative z-10 opacity-70',
      )}
    >
      {editing && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={_('settings.ttsReorder')}
          title={_('settings.ttsReorder')}
          className="flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <DragHandleIcon />
        </button>
      )}

      <TtsProviderIcon provider={service.provider} className="h-8 w-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-stone-800 dark:text-stone-100">{service.name}</p>
        {service.model && <p className="mt-0.5 truncate text-xs text-stone-400">{service.model}</p>}
      </div>

      {!editing || !canEdit ? (
        <>
          {service.availability === 'instance' && <Badge>{_('settings.resourceScopeInstance')}</Badge>}
          <div className="flex shrink-0 items-center gap-1">
            <Toggle checked={service.enabled} disabled={disabled} ariaLabel={service.name} onChange={onToggle} />
          </div>
        </>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            aria-label={_('settings.ttsEdit')}
            title={_('settings.ttsEdit')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <EditIcon />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            aria-label={_('settings.ttsDelete')}
            title={_('settings.ttsDelete')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/40"
          >
            <TrashIcon />
          </button>
        </div>
      )}
    </li>
  )
}
