import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import Badge from '@/components/ui/Badge'
import Toggle from '@/components/ui/Toggle'
import type { FontOption } from '@/features/reader/fonts'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { DragHandleIcon, EditIcon, TrashIcon } from './row-icons'

interface FontRowProps {
  font: FontOption
  isOwner: boolean
  disabled: boolean
  sorting: boolean
  selectable?: boolean
  selected?: boolean
  onSelectChange?: (checked: boolean) => void
  onToggle: () => void
  onLoad: () => void
  onEdit: () => void
  onDelete: () => void
}

export function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  )
}

export function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="animate-spin">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
}

export default function FontRow({
  font,
  isOwner,
  disabled,
  sorting,
  selectable = false,
  selected = false,
  onSelectChange,
  onToggle,
  onLoad,
  onEdit,
  onDelete,
}: FontRowProps) {
  const _ = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: font.id,
    animateLayoutChanges: () => false,
  })
  const uploaded = font.uploaded
  const isDevice = font.source === 'device'
  // Device fonts belong to this browser: always manageable, no role check
  const canDelete = isDevice || (font.source === 'uploaded' && !!uploaded && (uploaded.mine || isOwner))

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border border-stone-200/80 bg-stone-50/50 px-3 py-2.5 transition-[background-color,border-color,opacity,box-shadow] dark:border-stone-800/80 dark:bg-stone-900/40',
        !font.enabled && 'opacity-60 bg-transparent dark:bg-transparent',
        isDragging && 'relative z-10 opacity-70 shadow-md ring-1 ring-violet-500/30',
      )}
    >
      {sorting && (
        <input
          type="checkbox"
          checked={selectable ? selected : false}
          disabled={disabled || !selectable}
          aria-label={font.name}
          onChange={(event) => onSelectChange?.(event.target.checked)}
          className={cn(
            'h-4 w-4 shrink-0 accent-stone-700 dark:accent-stone-300',
            !selectable && 'cursor-not-allowed opacity-40',
          )}
        />
      )}
      {sorting && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={_('settings.fontsReorder')}
          title={_('settings.fontsReorder')}
          className="flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <DragHandleIcon />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p
            className="truncate text-sm"
            style={{ fontFamily: font.stack }}
          >
            {font.name}
          </p>
          {font.source === 'builtin' && font.status !== 'ready' && (
            <button
              type="button"
              onClick={onLoad}
              disabled={disabled || sorting || font.status === 'loading'}
              aria-label={_('settings.fontsLoad')}
              title={_('settings.fontsLoad')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              {font.status === 'loading' ? <SpinnerIcon /> : <DownloadIcon />}
            </button>
          )}
        </div>
      </div>

      {!sorting && (
        <>
          {uploaded ? (
            <Badge>{_(uploaded.scope === 'instance' ? 'settings.resourceScopeInstance' : 'settings.resourceScopeUser')}</Badge>
          ) : isDevice ? (
            <Badge>{_('settings.fontsScopeDevice')}</Badge>
          ) : (
            <Badge>{_(font.source === 'builtin' ? 'settings.fontsBuiltIn' : 'settings.fontsSystem')}</Badge>
          )}
          <div className="flex shrink-0 items-center gap-1">
            <Toggle checked={font.enabled} onChange={onToggle} disabled={disabled} ariaLabel={font.name} />
          </div>
        </>
      )}

      {sorting && (
        <div className="flex shrink-0 items-center gap-1">
          {(uploaded || isDevice) && (
            <button
              type="button"
              onClick={onEdit}
              disabled={disabled}
              aria-label={_('settings.fontsEdit')}
              title={_('settings.fontsEdit')}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              <EditIcon />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={disabled}
              aria-label={_('settings.fontsDelete')}
              title={_('settings.fontsDelete')}
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
