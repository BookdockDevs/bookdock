import { useRef } from 'react'

import { useDndContext } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { ShelfListItem } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { isBookDrag } from '../dnd'
import HiddenIndicator from './HiddenIndicator'
import { MenuHeader } from './RowMenuChrome'
import TaxonomyIcon from './TaxonomyIcon'
import { useContextMenu } from './use-context-menu'

interface TaxonomyEntryProps {
  row: Pick<ShelfListItem, 'id' | 'name' | 'bookCount' | 'hidden' | 'pinned'>
  isTag?: boolean
  isCategory?: boolean
  directory?: boolean
  directoryHeading?: boolean
  sortableId?: string
  inheritedHidden?: boolean
  active?: boolean
  settling?: boolean
  selecting?: boolean
  selected?: boolean
  readOnly?: boolean
  orderingPending?: boolean
  title?: string
  isExpanded?: boolean
  indent?: boolean
  onClick: () => void
  onOpen?: () => void
  onPointerEnter?: () => void
  onEdit: () => void
  onDelete: () => void
  onTogglePin: () => void
  onToggleHidden: () => void
  onNewChild?: () => void
}

export default function TaxonomyEntry({ row, isTag = false, isCategory = false, directory = false, directoryHeading = false, sortableId = row.id,
  inheritedHidden = false, active = false, settling = false, selecting = false, selected = false,
  readOnly = false, orderingPending = false, title, isExpanded,
  indent = false, onClick, onOpen, onPointerEnter, onEdit, onDelete,
  onTogglePin, onToggleHidden, onNewChild }: TaxonomyEntryProps) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const dragged = useRef(false)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId, data: { type: isTag ? 'tag' : 'shelf', entryId: row.id },
    disabled: readOnly || selecting || orderingPending, animateLayoutChanges: () => false,
  })
  const { active: dragActive, over } = useDndContext()
  const dropHint = !directory && !isTag && isBookDrag(dragActive?.data.current) && over?.id === row.id
  const hasMenu = !selecting && !readOnly
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition: settling ? 'transform 120ms ease-out' : transition }}
    className={cn('group relative min-w-0', directory && 'rounded-lg', selected && 'ring-2 ring-stone-500', isDragging && 'z-10 opacity-60')}
    onPointerDownCapture={() => { dragged.current = false }}
    onPointerMoveCapture={() => { if (isDragging) dragged.current = true }}
    onContextMenu={hasMenu ? (event) => { event.preventDefault(); event.stopPropagation(); menu.openFromEvent(event) } : undefined}>
    <button ref={setActivatorNodeRef} type="button" {...(readOnly || selecting || orderingPending ? {} : attributes)} {...listeners} title={title ?? (inheritedHidden ? _('library.hiddenByParent') : row.hidden ? _('library.catalogUnlisted') : undefined)}
      onClick={() => { if (!dragged.current) onClick() }} onPointerEnter={onPointerEnter}
      aria-pressed={selecting ? selected : undefined}
      aria-expanded={isExpanded}
      className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-all', directory && 'min-h-10', hasMenu && 'pr-10 md:pr-3',
        indent && 'pl-7',
        active || dropHint ? 'bg-white font-medium text-stone-900 shadow-sm ring-1 ring-stone-200/70 dark:bg-stone-800 dark:text-stone-50 dark:ring-stone-700/60' : 'text-stone-600 hover:bg-stone-200/50 dark:text-stone-400 dark:hover:bg-stone-800/50',
        directoryHeading && 'font-medium text-stone-900 dark:text-stone-100')}>
      <span className="flex min-w-0 items-center gap-2">
        {selecting ? <span aria-hidden="true" className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border border-stone-400', selected && 'bg-stone-800 text-white dark:bg-stone-100 dark:text-stone-900')}>{selected ? '✓' : ''}</span>
          : isTag ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400" aria-hidden="true">
            <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42z" /><circle cx="7" cy="7" r="1" />
          </svg> : <TaxonomyIcon kind={isCategory ? 'category' : 'shelf'} size={15} className="shrink-0 text-stone-400" />}
        <span className="truncate">{row.name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {(row.hidden || inheritedHidden) && <HiddenIndicator kind="work" title={inheritedHidden ? _('library.hiddenByParent') : undefined} />}
        <span className={cn('rounded-full bg-stone-200/40 px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums text-stone-400 transition-all dark:bg-stone-900/60', hasMenu && 'group-hover:opacity-0 group-has-[:focus-visible]:opacity-0', hasMenu && menu.open && 'opacity-0')}>{row.bookCount}</span>
      </span>
    </button>
    {hasMenu && <div className="absolute right-2 top-1/2 -translate-y-1/2">
      <button ref={menu.btnRef} type="button" aria-label={_('library.moreActions')}
        onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); menu.toggleFromButton() }}
        className={cn('flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition-all hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200', menu.open ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-has-[:focus-visible]:opacity-100')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
      </button>
    </div>}
      {hasMenu && <SmartMenu triggerRef={menu.btnRef} innerRef={menu.menuRef} position={menu.position(152, onNewChild ? 224 : 186)} onClose={menu.close} width={152}>
        <MenuHeader title={row.name} subtitle={_('library.bookCount', { count: row.bookCount })}
          onClick={() => { menu.close(); (onOpen ?? onClick)() }} />
        <button
          type="button"
          onClick={() => {
            menu.close()
            onEdit()
          }}
          className={menuItemClass}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          {_('library.edit')}
        </button>
        {onNewChild && <button type="button" onClick={() => { menu.close(); onNewChild() }} className={menuItemClass}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400" aria-hidden="true">
            <path d="M3 7V3h6l2 3h10v14H3V7m9 4v6m-3-3h6" />
          </svg>
          {_('library.newSubcategory')}
        </button>}
        <button
          type="button"
          onClick={() => {
            menu.close()
            onTogglePin()
          }}
          className={menuItemClass}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
          {row.pinned ? _('library.unpin') : _('library.pin')}
        </button>
        <button
          type="button"
          onClick={() => {
            menu.close()
            onToggleHidden()
          }}
          className={menuItemClass}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            {row.hidden ? (
              <>
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </>
            ) : (
              <>
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" x2="22" y1="2" y2="22" />
              </>
            )}
          </svg>
          {row.hidden ? _('library.show') : _('library.hide')}
        </button>
        <div role="separator" className="mx-1.5 my-1 border-t border-stone-100 dark:border-stone-800" />
        <button
          type="button"
          onClick={() => {
            menu.close()
            onDelete()
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-red-400">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
          </svg>
          {_('library.delete')}
        </button>
      </SmartMenu>}
  </div>
}

const menuItemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'
