import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import Toggle from '@/components/ui/Toggle'
import type { FontOption } from '@/features/reader/fonts'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

interface FontRowProps {
  font: FontOption
  isOwner: boolean
  disabled: boolean
  sorting: boolean
  onToggle: () => void
  onLoad: () => void
  onEdit: () => void
  onDelete: () => void
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="animate-spin">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
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

export default function FontRow({ font, isOwner, disabled, sorting, onToggle, onLoad, onEdit, onDelete }: FontRowProps) {
  const _ = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: font.id,
    animateLayoutChanges: () => false,
  })
  const uploaded = font.uploaded
  const canDelete = font.source === 'uploaded' && !!uploaded && (uploaded.mine || isOwner)
  const badge = 'inline-flex shrink-0 rounded border border-stone-200 px-1.5 py-0.5 text-[10px] text-stone-400 dark:border-stone-700'

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-3 py-3', !font.enabled && 'opacity-60', isDragging && 'relative z-10 opacity-60')}
    >
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
          {uploaded && <span className={badge}>{_(uploaded.scope === 'instance' ? 'settings.fontsScopeInstance' : 'settings.fontsScopeUser')}</span>}
          <span className={badge}>
            {_(font.source === 'builtin' ? 'settings.fontsBuiltIn' : font.source === 'system' ? 'settings.fontsSystem' : 'settings.fontsCustom')}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Toggle checked={font.enabled} onChange={onToggle} disabled={disabled} ariaLabel={font.name} />
          </div>
        </>
      )}

      {sorting && (
        <div className="flex shrink-0 items-center gap-1">
          {font.source === 'uploaded' && (
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
