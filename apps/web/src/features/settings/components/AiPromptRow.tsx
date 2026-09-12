import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { AiPromptTemplate } from '@bookdock/shared'

import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

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
        <p className="truncate text-xs">
          {prompt.name}
        </p>
        <p className="truncate text-[11px] text-stone-400">
          {prompt.prompt}
        </p>
      </div>

      <span className="inline-flex shrink-0 rounded border border-stone-200 px-1.5 py-0.5 text-[10px] text-stone-400 dark:border-stone-700">
        {prompt.builtIn ? _('settings.aiPromptBuiltIn') : _('settings.aiPromptCustom')}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Toggle checked={prompt.enabled} onChange={onToggle} disabled={disabled} ariaLabel={prompt.name} />
        {sorting && (
          <>
            <button type="button" onClick={onEdit} disabled={disabled} aria-label={_('settings.aiEdit')} title={_('settings.aiEdit')} className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
            <button type="button" onClick={onDelete} disabled={disabled} aria-label={_('settings.aiPromptDelete')} title={_('settings.aiPromptDelete')} className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-red-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M19 6v14c0 1-2 2-2 2H7a2 2 0 0 1-2-2V6M8 6V4c0-1 2-2 2-2h4c1 0 2 2 2 2v2" />
              </svg>
            </button>
          </>
        )}
      </div>
    </li>
  )
}
