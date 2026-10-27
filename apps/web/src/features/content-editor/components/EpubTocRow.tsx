import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface EpubTocRowProps {
  index: number
  title: string
  depth: number
  selected: boolean
  active: boolean
  expanded: boolean
  hasChildren: boolean
  dragDisabled: boolean
  dropPlacement: 'before' | 'after' | null
  onSelect: (event: React.MouseEvent | React.KeyboardEvent) => void
  onToggleExpanded: () => void
}

export default function EpubTocRow({
  index,
  title,
  depth,
  selected,
  active,
  expanded,
  hasChildren,
  dragDisabled,
  dropPlacement,
  onSelect,
  onToggleExpanded,
}: EpubTocRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `toc-${index}`, disabled: dragDisabled })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !isDragging) {
          event.preventDefault()
          onSelect(event)
        } else listeners?.onKeyDown?.(event)
      }}
      aria-label={title || '（无标题）'}
      aria-current={active ? 'location' : undefined}
      className={`relative flex min-w-0 cursor-grab select-none items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors active:cursor-grabbing ${active ? 'bg-stone-500/12 font-medium text-stone-900 ring-1 ring-stone-500/20 dark:text-stone-100' : selected ? 'bg-stone-500/8 text-stone-900 ring-1 ring-stone-500/10 dark:bg-stone-500/15 dark:text-stone-100' : 'text-stone-600 hover:bg-stone-500/5 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-500/10 dark:hover:text-stone-100'}`}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1, paddingLeft: `${depth * 14 + 8}px` }}
      title={title}
    >
      {dropPlacement && <span className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-stone-500 dark:bg-stone-300 ${dropPlacement === 'before' ? '-top-0.5' : '-bottom-0.5'}`} aria-hidden="true" />}
      {active && <span className="absolute left-1 top-1.5 bottom-1.5 w-1 rounded-full bg-stone-900 dark:bg-stone-100" aria-hidden="true" />}
      {hasChildren ? (
        <button type="button" aria-label={`${expanded ? '折叠' : '展开'} ${title}`} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onToggleExpanded() }} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-stone-400 hover:bg-stone-500/10 hover:text-stone-700 dark:hover:text-stone-200">
          <svg className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      ) : <span className="h-5 w-5 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{title || '（无标题）'}</span>
    </div>
  )
}
