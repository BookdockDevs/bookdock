import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface EpubFileRowProps {
  href: string
  index: number
  active: boolean
  unlisted: boolean
  onSelect: () => void
}

export default function EpubFileRow({ href, index, active, unlisted, onSelect }: EpubFileRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: href })
  const name = href.split('/').at(-1) || href
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={onSelect} onKeyDown={(event) => {
      if (event.key === 'Enter' && !isDragging) { event.preventDefault(); onSelect() }
      else listeners?.onKeyDown?.(event)
    }} aria-label={`${index + 1}. ${name}`} aria-current={active ? 'location' : undefined}
      className={`flex cursor-grab select-none items-center gap-2 rounded-lg px-2 py-2 text-sm active:cursor-grabbing ${active ? 'bg-stone-500/12 font-medium text-stone-900 dark:text-stone-100' : 'text-stone-600 hover:bg-stone-500/5 dark:text-stone-400'}`}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 }}>
      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-stone-400">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {unlisted && <span className="shrink-0 text-[10px] text-stone-400">未列入目录</span>}
    </div>
  )
}
