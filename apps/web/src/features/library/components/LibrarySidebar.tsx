import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { useDndContext, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { ShelfListItem, TagListItem } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import type { LibrarySearch } from '@/routes/index'
import SmartMenu from '@/components/ui/SmartMenu'
import AccountMenu from '@/features/auth/AccountMenu'
import { applyShelfOrder, applyTagOrder, isBookDrag, SHELF_NONE_DROPPABLE } from '../dnd'
import { useBooks, useShelves, useTags, useDeleteShelf, useDeleteTag, useTrashEnabled } from '../hooks'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import ShelfDialog from './ShelfDialog'
import TagDialog from './TagDialog'
import { useContextMenu } from './use-context-menu'

interface LibrarySidebarProps {
  navSearch: (patch: Partial<LibrarySearch>) => void
  onPrefetchNavigation?: (patch: Partial<LibrarySearch>) => void
  shelfId: string | null
  tagId: string | null
  author: string | null
  series: string | null
  trash: boolean
  /** Mobile navigation drawer state; desktop keeps the sidebar in flow. */
  mobileOpen?: boolean
  onMobileClose?: () => void
  /** The scrollable nav element; the library autoscrolls it during shelf drags. */
  navRef?: React.RefObject<HTMLDivElement | null>
  /** Same-frame shelf order during drag end; see Library for the rationale. */
  shelfOrderOverride?: string[] | null
  /** Shelf row that was just released; its transform reset glides into place. */
  settleShelfId?: string | null
  /** Same-frame tag order during drag end. */
  tagOrderOverride?: string[] | null
  /** Tag row that was just released; its transform reset glides into place. */
  settleTagId?: string | null
}

const LibrarySidebar = memo(function LibrarySidebar({ navSearch, onPrefetchNavigation, shelfId, tagId, author, series, trash, mobileOpen = false, onMobileClose, navRef, shelfOrderOverride, settleShelfId, tagOrderOverride, settleTagId }: LibrarySidebarProps) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const { data: shelvesData, isLoading: shelvesLoading } = useShelves()
  const { data: tagsData, isLoading: tagsLoading } = useTags()

  const shelves = useMemo(
    () => applyShelfOrder(shelvesData?.data ?? [], shelfOrderOverride),
    [shelvesData, shelfOrderOverride],
  )
  const tags = useMemo(
    () => applyTagOrder(tagsData?.data ?? [], tagOrderOverride),
    [tagsData, tagOrderOverride],
  )
  const trashEnabled = useTrashEnabled()
  const { data: trashData } = useBooks({
    page: 1,
    pageSize: 1,
    search: '',
    sortBy: 'createdAt',
    sortOrder: 'desc',
    shelfId: null,
    tagId: null,
    format: null,
    readStatus: null,
    trash: true,
  }, { enabled: trashEnabled })
  const trashCount = trashData?.total

  const { data: uncategorizedData, isLoading: uncategorizedLoading } = useBooks({
    page: 1,
    pageSize: 1,
    search: '',
    sortBy: 'createdAt',
    sortOrder: 'desc',
    shelfId: 'none',
    tagId: null,
    format: null,
    readStatus: null,
    trash: false,
  })
  const uncategorizedCount = uncategorizedData?.total

  const [shelfDialog, setShelfDialog] = useState<{ shelfId?: string; initialName?: string } | null>(null)
  const [deleteShelfTarget, setDeleteShelfTarget] = useState<ShelfListItem | null>(null)
  const deleteShelf = useDeleteShelf()
  const [tagDialog, setTagDialog] = useState<{ tagId?: string; initialName?: string } | null>(null)
  const [deleteTagTarget, setDeleteTagTarget] = useState<TagListItem | null>(null)
  const deleteTag = useDeleteTag()

  const isAllActive = !shelfId && !tagId && !author && !series && !trash
  const isUncategorizedActive = !trash && shelfId === 'none'
  const isShelvesLoading = Boolean(shelvesLoading || (uncategorizedLoading && !isUncategorizedActive))

  const localNavRef = useRef<HTMLElement | null>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  const updateScrollShadows = useCallback(() => {
    const el = localNavRef.current
    if (!el) return
    setCanScrollUp(el.scrollTop > 2)
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 2)
  }, [])

  const setNavRef = useCallback(
    (el: HTMLElement | null) => {
      localNavRef.current = el
      if (navRef) {
        ;(navRef as unknown as React.MutableRefObject<HTMLElement | null>).current = el
      }
    },
    [navRef],
  )

  useEffect(() => {
    updateScrollShadows()
  }, [shelves, tags, shelvesLoading, mobileOpen, updateScrollShadows])

  useEffect(() => {
    const el = localNavRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(updateScrollShadows)
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateScrollShadows])

  function selectNavigation(patch: Partial<LibrarySearch>) {
    navSearch({ ...patch, author: undefined, series: undefined })
    onMobileClose?.()
  }

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label={_('library.closeNavigation')}
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}
      <aside className={cn(
        'w-60 shrink-0 flex-col border-r border-stone-200/60 px-3 py-6 md:sticky md:top-0 md:h-screen md:self-start dark:border-stone-800/50',
        mobileOpen
          ? 'fixed inset-y-0 left-0 z-50 flex h-full w-[min(19rem,75vw)] overflow-hidden bg-stone-50 shadow-xl dark:bg-stone-950 md:shadow-none'
          : 'hidden md:flex',
      )}>
      <div className="mb-8 flex items-center gap-2.5 px-2">
        <img src="/favicon.svg?v=5" alt="" aria-hidden="true" className="h-8 w-8 shrink-0 dark:invert" />
        <span className="font-serif text-base font-semibold tracking-wide text-stone-900 dark:text-stone-50">{_('app.name')}</span>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          data-testid="sidebar-scroll-shadow-top"
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 z-10 h-3.5 bg-gradient-to-b from-stone-400/20 to-transparent transition-opacity duration-200 dark:from-stone-950/80',
            canScrollUp ? 'opacity-100' : 'opacity-0',
          )}
        />

        <nav
          ref={setNavRef}
          onScroll={updateScrollShadows}
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] -mx-1 px-1 py-0.5 -my-0.5"
        >
        <NavItem
          label={_('library.allBooks')}
          active={isAllActive}
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          }
          onClick={() => selectNavigation({ shelf: undefined, tag: undefined, status: undefined, trash: undefined })}
          onPointerEnter={() => onPrefetchNavigation?.({ shelf: undefined, tag: undefined, status: undefined, trash: undefined })}
        />
        <div className="mb-1 mt-6 flex items-center justify-between px-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-400">
            {_('library.shelves')}
          </span>
          <button
            type="button"
            onClick={() => setShelfDialog({})}
            className="-mr-[3px] flex h-5 w-5 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            title={_('library.newShelf')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        {isShelvesLoading ? (
          <div className="space-y-1 py-1" aria-busy="true">
            <div className="flex h-8 animate-pulse items-center gap-2.5 rounded-lg px-3">
              <div className="h-3.5 w-3.5 rounded bg-stone-200/70 dark:bg-stone-800/80" />
              <div className="h-3 w-20 rounded bg-stone-200/60 dark:bg-stone-800/60" />
            </div>
            <div className="flex h-8 animate-pulse items-center gap-2.5 rounded-lg px-3">
              <div className="h-3.5 w-3.5 rounded bg-stone-200/70 dark:bg-stone-800/80" />
              <div className="h-3 w-14 rounded bg-stone-200/60 dark:bg-stone-800/60" />
            </div>
          </div>
        ) : (
          <>
            <UncategorizedDropTarget
              count={uncategorizedCount}
              active={isUncategorizedActive}
              onClick={() => selectNavigation({ shelf: 'none', tag: undefined, status: undefined, trash: undefined })}
              onPointerEnter={() => onPrefetchNavigation?.({ shelf: 'none', tag: undefined, status: undefined, trash: undefined })}
            />
            {shelves.length > 0 ? (
              <SortableContext items={shelves.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                {shelves.map((shelf) => (
                  <ShelfItem
                    key={shelf.id}
                    shelf={shelf}
                    active={!trash && shelfId === shelf.id}
                    settling={settleShelfId === shelf.id}
                    onClick={() => selectNavigation({ shelf: shelf.id, tag: undefined, status: undefined, trash: undefined })}
                    onPointerEnter={() => onPrefetchNavigation?.({ shelf: shelf.id, tag: undefined, status: undefined, trash: undefined })}
                    onRename={() => setShelfDialog({ shelfId: shelf.id, initialName: shelf.name })}
                    onDelete={() => setDeleteShelfTarget(shelf)}
                  />
                ))}
              </SortableContext>
            ) : null}
          </>
        )}

        <div className="mb-1 mt-6 flex items-center justify-between px-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-400">
            {_('library.tags')}
          </span>
          <button
            type="button"
            onClick={() => setTagDialog({})}
            className="-mr-[3px] flex h-5 w-5 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            title={_('library.newTag')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        {tagsLoading ? (
          <div className="space-y-1 py-1" aria-busy="true">
            <div className="flex h-8 animate-pulse items-center gap-2.5 rounded-lg px-3">
              <div className="h-3.5 w-3.5 rounded bg-stone-200/70 dark:bg-stone-800/80" />
              <div className="h-3 w-16 rounded bg-stone-200/60 dark:bg-stone-800/60" />
            </div>
          </div>
        ) : tags.length === 0 ? (
          <div className="px-3 py-1 text-xs text-stone-400">{_('library.noTags')}</div>
        ) : (
          <SortableContext items={tags.map((tag) => tag.id)} strategy={verticalListSortingStrategy}>
            {tags.map((tag) => (
              <TagItem
                key={tag.id}
                tag={tag}
                settling={settleTagId === tag.id}
                active={!trash && tagId === tag.id}
                onClick={() => selectNavigation({ tag: tag.id, shelf: undefined, status: undefined, trash: undefined })}
                onPointerEnter={() => onPrefetchNavigation?.({ tag: tag.id, shelf: undefined, status: undefined, trash: undefined })}
                onRename={() => setTagDialog({ tagId: tag.id, initialName: tag.name })}
                onDelete={() => setDeleteTagTarget(tag)}
              />
            ))}
          </SortableContext>
        )}

        {trashEnabled && (
          <div className="mt-6 border-t border-stone-200/60 pt-4 dark:border-stone-800/50">
            <NavItem
              label={_('library.trash')}
              count={trashCount}
              active={trash}
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                </svg>
              }
              onClick={() => selectNavigation({ trash: true, shelf: undefined, tag: undefined, status: undefined })}
              onPointerEnter={() => onPrefetchNavigation?.({ trash: true, shelf: undefined, tag: undefined, status: undefined })}
            />
          </div>
        )}
      </nav>

      <div
        data-testid="sidebar-scroll-shadow-bottom"
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-10 h-3.5 bg-gradient-to-t from-stone-400/20 to-transparent transition-opacity duration-200 dark:from-stone-950/80',
          canScrollDown ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>

      <div className="mt-auto px-2 pt-6">
        <NavItem
          label={_('stats.title')}
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <rect x="7" y="12" width="3" height="6" rx="1" />
              <rect x="12" y="8" width="3" height="10" rx="1" />
              <rect x="17" y="4" width="3" height="14" rx="1" />
            </svg>
          }
          onClick={() => {
            onMobileClose?.()
            void navigate({ to: '/stats' })
          }}
          onPointerEnter={() => {
            void import('@/features/stats/Stats')
          }}
        />
        <NavItem
          label={_('settings.title')}
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          }
          onClick={() => {
            onMobileClose?.()
            void navigate({ to: '/settings' })
          }}
          onPointerEnter={() => {
            void import('@/features/settings/Settings')
          }}
        />
        <div className="mt-1">
          <AccountMenu />
        </div>
      </div>

      <ShelfDialog
        open={shelfDialog !== null}
        shelfId={shelfDialog?.shelfId}
        initialName={shelfDialog?.initialName}
        onClose={() => setShelfDialog(null)}
      />

      <TagDialog
        open={tagDialog !== null}
        tagId={tagDialog?.tagId}
        initialName={tagDialog?.initialName}
        onClose={() => setTagDialog(null)}
      />

      {deleteShelfTarget && (
        <ConfirmDialog
          title={_('library.deleteShelf')}
          message={_('library.deleteShelfConfirm', { name: deleteShelfTarget.name ?? '' })}
          confirmLabel={_('reader.delete')}
          confirmVariant="danger"
          onClose={() => setDeleteShelfTarget(null)}
          onConfirm={() => {
            const target = deleteShelfTarget
            setDeleteShelfTarget(null)
            if (shelfId === target.id) selectNavigation({ shelf: undefined, tag: undefined, status: undefined, trash: undefined })
            void deleteShelf.mutateAsync(target.id).catch(() => undefined)
          }}
        />
      )}

      {deleteTagTarget && (
        <ConfirmDialog
          title={_('library.deleteTag')}
          message={_('library.deleteTagConfirm', { name: deleteTagTarget.name ?? '' })}
          confirmLabel={_('reader.delete')}
          confirmVariant="danger"
          onClose={() => setDeleteTagTarget(null)}
          onConfirm={() => {
            const target = deleteTagTarget
            setDeleteTagTarget(null)
            if (tagId === target.id) selectNavigation({ shelf: undefined, tag: undefined, status: undefined, trash: undefined })
            void deleteTag.mutateAsync(target.id).catch(() => undefined)
          }}
        />
      )}
      </aside>
    </>
  )
})

export default LibrarySidebar

function NavItem({
  label,
  count,
  countHidden = false,
  hasMenu = false,
  active = false,
  icon,
  onClick,
  onPointerEnter,
}: {
  label: string
  count?: number
  countHidden?: boolean
  hasMenu?: boolean
  active?: boolean
  icon?: React.ReactNode
  onClick: () => void
  onPointerEnter?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      className={cn(
        'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-all',
        hasMenu && 'pr-10 md:pr-3',
        active
          ? 'bg-white font-medium text-stone-900 shadow-sm ring-1 ring-stone-200/70 dark:bg-stone-800 dark:text-stone-50 dark:ring-stone-700/60 dark:shadow-xs'
          : 'text-stone-500 hover:bg-stone-200/50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/50 dark:hover:text-stone-100',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {icon && (
          <span
            className={cn(
              'shrink-0 transition-colors',
              active ? 'text-stone-700 dark:text-stone-200' : 'text-stone-400 dark:text-stone-500',
            )}
          >
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </span>
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            'ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums transition-all',
            hasMenu && 'group-hover:opacity-0',
            countHidden && 'opacity-0',
            active
              ? 'bg-stone-100 text-stone-700 dark:bg-stone-700/60 dark:text-stone-200'
              : 'text-stone-400 bg-stone-200/40 group-hover:bg-stone-200/70 group-hover:text-stone-600 dark:text-stone-400 dark:bg-stone-900/60 dark:group-hover:bg-stone-800/70 dark:group-hover:text-stone-300',
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function UncategorizedDropTarget({
  count,
  active,
  onClick,
  onPointerEnter,
}: {
  count?: number
  active: boolean
  onClick: () => void
  onPointerEnter?: () => void
}) {
  const _ = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id: SHELF_NONE_DROPPABLE })
  const { active: dragActive } = useDndContext()
  const isBookDragging = isBookDrag(dragActive?.data.current)
  const dropHint = isBookDragging && isOver
  const visible = active || (count !== undefined && count > 0) || isBookDragging

  if (!visible) return null

  return (
    <div ref={setNodeRef} className="relative">
      <NavItem
        label={_('library.uncategorized')}
        count={count}
        active={active || dropHint}
        icon={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        }
        onClick={onClick}
        onPointerEnter={onPointerEnter}
      />
    </div>
  )
}

function ShelfItem({
  shelf,
  active,
  settling,
  onClick,
  onPointerEnter,
  onRename,
  onDelete,
}: {
  shelf: ShelfListItem
  active: boolean
  settling: boolean
  onClick: () => void
  onPointerEnter?: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const _ = useTranslation()
  const menu = useContextMenu()
  // animateLayoutChanges=false keeps rows from animating between old and new
  // slots on drop. The released row instead gets a short glide: CSS transitions
  // animate from the last painted transform (the release position), so a plain
  // 120ms transition on the reset lets it settle into its slot smoothly.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: shelf.id,
    data: { type: 'shelf' },
    animateLayoutChanges: () => false,
  })
  const { active: dragActive, over } = useDndContext()
  const dropHint = isBookDrag(dragActive?.data.current) && over?.id === shelf.id

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: settling ? 'transform 120ms ease-out' : transition,
      }}
      className={cn('group relative', isDragging && 'z-10 opacity-60')}
      {...attributes}
      {...listeners}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        menu.openFromEvent(e)
      }}
    >
      <NavItem
        label={shelf.name}
        count={shelf.bookCount}
        countHidden={menu.open}
        hasMenu
        active={active || dropHint}
        icon={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        }
        onClick={onClick}
        onPointerEnter={onPointerEnter}
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <button
          ref={menu.btnRef}
          type="button"
          aria-label={_('library.moreActions')}
          onClick={(e) => {
            e.stopPropagation()
            menu.toggleFromButton()
          }}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition-all hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200',
            menu.open ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100',
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
      </div>
      <SmartMenu triggerRef={menu.btnRef} innerRef={menu.menuRef} position={menu.position(152, 148)} onClose={menu.close} width={152}>
        <div className="mx-1.5 mb-1 border-b border-stone-100 px-1.5 pb-2 pt-1.5 dark:border-stone-800">
          <p className="truncate text-xs font-medium text-stone-900 dark:text-stone-100">{shelf.name}</p>
          <p className="mt-0.5 text-[10px] text-stone-400 dark:text-stone-500">
            {_('library.bookCount', { count: shelf.bookCount })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            menu.close()
            onRename()
          }}
          className={shelfMenuItemClass}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          {_('library.rename')}
        </button>
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
      </SmartMenu>
    </div>
  )
}

const shelfMenuItemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'

function TagItem({
  tag,
  settling,
  active,
  onClick,
  onPointerEnter,
  onRename,
  onDelete,
}: {
  tag: TagListItem
  settling: boolean
  active: boolean
  onClick: () => void
  onPointerEnter?: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tag.id,
    data: { type: 'tag' },
    animateLayoutChanges: () => false,
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: settling ? 'transform 120ms ease-out' : transition,
      }}
      className={cn('group relative', isDragging && 'z-10 opacity-60')}
      {...attributes}
      {...listeners}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        menu.openFromEvent(e)
      }}
    >
      <NavItem
        label={tag.name}
        count={tag.bookCount}
        countHidden={menu.open}
        hasMenu
        active={active}
        icon={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42z" />
            <circle cx="7" cy="7" r="1" />
          </svg>
        }
        onClick={onClick}
        onPointerEnter={onPointerEnter}
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <button
          ref={menu.btnRef}
          type="button"
          aria-label={_('library.moreActions')}
          onClick={(e) => {
            e.stopPropagation()
            menu.toggleFromButton()
          }}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition-all hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200',
            menu.open ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100',
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
      </div>
      <SmartMenu triggerRef={menu.btnRef} innerRef={menu.menuRef} position={menu.position(152, 148)} onClose={menu.close} width={152}>
        <div className="mx-1.5 mb-1 border-b border-stone-100 px-1.5 pb-2 pt-1.5 dark:border-stone-800">
          <p className="truncate text-xs font-medium text-stone-900 dark:text-stone-100">{tag.name}</p>
          <p className="mt-0.5 text-[10px] text-stone-400 dark:text-stone-500">
            {_('library.bookCount', { count: tag.bookCount })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            menu.close()
            onRename()
          }}
          className={shelfMenuItemClass}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          {_('library.rename')}
        </button>
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
      </SmartMenu>
    </div>
  )
}
