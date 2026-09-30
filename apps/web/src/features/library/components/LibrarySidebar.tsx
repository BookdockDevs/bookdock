import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { useDndContext, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { LibraryListItem, LibraryRelation } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'

import type { LibrarySearch } from '@/routes/index'
import SmartMenu from '@/components/ui/SmartMenu'
import AccountMenu from '@/features/auth/AccountMenu'
import { applyLibraryOrder, applyShelfOrder, applyTagOrder, isBookDrag, SHELF_NONE_DROPPABLE } from '../dnd'
import { sortSidebarItems } from '../sort-modes'
import { useBooks, useShelves, useTags, useDeleteShelf, useDeleteTag, useToggleShelfPin, useToggleShelfHidden, useToggleTagPin, useToggleTagHidden, useTrashEnabled, useLibraryPrefs, useHiddenLibraries, useLibraryCategories, useLibraryTags, useLibraryCatalog, useLibraryRelation, useUpdateLibraryCategory, useDeleteLibraryCategory, useUpdateLibraryTag, useDeleteLibraryTag } from '../hooks'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import HiddenIndicator from './HiddenIndicator'
import LibraryDetailsDialog from './LibraryDetailsDialog'
import ShelfDialog from './ShelfDialog'
import TagDialog from './TagDialog'
import PrivateLibraryRenameDialog from './PrivateLibraryRenameDialog'
import { useContextMenu } from './use-context-menu'

interface LibrarySidebarProps {
  navSearch: (patch: Partial<LibrarySearch>) => void
  onPrefetchNavigation?: (patch: Partial<LibrarySearch>, targetLibraryId?: string | null) => void
  shelfId: string | null
  tagId: string | null
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
  /** Guest sessions may browse but cannot mutate library organization. */
  readOnly?: boolean
  /**
   * Libraries the reader can switch between (0.4.0). Each row carries the
   * reader's relation to it, so the row's own menu can offer what applies to
   * that reader. Switching one changes what the shelves, tags and the book list
   * below mean, the same way picking a shelf does - there is no separate
   * library page.
   */
  libraries?: LibraryListItem[]
  activeLibraryId?: string | null
  onSelectLibrary?: (libraryId: string | null) => void
  onManageLibrary?: (library: LibraryListItem) => void
  /** Opens the join flow for a library the reader can see but has not joined. */
  onJoinLibrary?: (library: LibraryListItem) => void
  /** Opens the discovery dialog showing all public and password libraries. */
  onExploreLibraries?: () => void
}
const LibrarySidebar = memo(function LibrarySidebar({ navSearch, onPrefetchNavigation, shelfId, tagId, trash, readOnly = false, mobileOpen = false, onMobileClose, navRef, shelfOrderOverride, settleShelfId, tagOrderOverride, settleTagId, libraries, activeLibraryId = null, onSelectLibrary, onManageLibrary, onJoinLibrary, onExploreLibraries }: LibrarySidebarProps) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const { data: shelvesData, isLoading: shelvesLoading } = useShelves()
  const { data: tagsData, isLoading: tagsLoading } = useTags()
  // 0.4.0: the library in context decides which taxonomy the rows below the
  // library switcher are. A private library's shelf is a library category, so
  // this is one list read from whichever library is selected - not a second set
  // of sidebar rows for shared libraries.
  const inLibrary = activeLibraryId !== null
  const categoriesQuery = useLibraryCategories(activeLibraryId)
  const libraryTagsQuery = useLibraryTags(activeLibraryId)
  const relationQuery = useLibraryRelation(activeLibraryId)
  const canCurate = inLibrary
    && (relationQuery.data?.data.relation === 'owner' || relationQuery.data?.data.relation === 'admin')
  const libraryPrefs = useLibraryPrefs()

  // Auto modes re-sort the full list client-side over the server (manual)
  // order; the same memo exists in Library for the drag materialization. Both
  // taxonomies satisfy SidebarSortableItem, so the preference applies to either.
  const shelves = useMemo(
    () => sortSidebarItems(
      applyShelfOrder(inLibrary ? (categoriesQuery.data?.data ?? []) : (shelvesData?.data ?? []), shelfOrderOverride),
      libraryPrefs?.shelfSort,
    ),
    [inLibrary, categoriesQuery.data, shelvesData, shelfOrderOverride, libraryPrefs?.shelfSort],
  )
  const tags = useMemo(
    () => sortSidebarItems(
      applyTagOrder(inLibrary ? (libraryTagsQuery.data?.data ?? []) : (tagsData?.data ?? []), tagOrderOverride),
      libraryPrefs?.tagSort,
    ),
    [inLibrary, libraryTagsQuery.data, tagsData, tagOrderOverride, libraryPrefs?.tagSort],
  )
  const taxonomyLoading = inLibrary
    ? (categoriesQuery.isLoading || libraryTagsQuery.isLoading)
    : (shelvesLoading || tagsLoading)
  const revealHidden = useUiStore((s) => s.revealHidden)
  const trashEnabled = useTrashEnabled({ enabled: !readOnly && !inLibrary })
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
  // Shared-library trash is owner-only: the row relation comes from the list,
  // falling back to the per-library query while it loads.
  const activeLibraryRow = (libraries ?? []).find((library) => library.id === activeLibraryId)
  const sharedTrashVisible = inLibrary && !readOnly
    && ((activeLibraryRow?.relation ?? relationQuery.data?.data.relation) === 'owner')
  const libraryTrashEnabled = activeLibraryRow?.trashEnabled ?? true
  const { data: libraryTrashData } = useLibraryCatalog(
    sharedTrashVisible && libraryTrashEnabled ? activeLibraryId : null,
    { page: 1, pageSize: 1, trash: true },
  )
  const libraryTrashCount = libraryTrashData?.data.total

  // The uncategorized count is a per-view badge, so it is asked of whichever
  // list is in context: a private library's books, or the shared catalog's
  // works filed under no category.
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
    showHidden: revealHidden,
  }, { enabled: !inLibrary })
  const { data: libraryUncategorizedData, isLoading: libraryUncategorizedLoading } = useLibraryCatalog(
    activeLibraryId,
    { page: 1, pageSize: 1, categoryId: 'none' },
  )
  const uncategorizedCount = inLibrary ? libraryUncategorizedData?.data.total : uncategorizedData?.total

  const [shelfDialog, setShelfDialog] = useState<{ shelfId?: string; initialName?: string } | null>(null)
  const [deleteShelfTarget, setDeleteShelfTarget] = useState<TaxonomyRow | null>(null)
  const deleteShelf = useDeleteShelf()
  const toggleShelfPin = useToggleShelfPin()
  const toggleShelfHidden = useToggleShelfHidden()
  const updateLibraryCategory = useUpdateLibraryCategory()
  const deleteLibraryCategory = useDeleteLibraryCategory()
  const [tagDialog, setTagDialog] = useState<{ tagId?: string; initialName?: string } | null>(null)
  const [renamePrivateTarget, setRenamePrivateTarget] = useState<LibraryListItem | null>(null)
  const [deleteTagTarget, setDeleteTagTarget] = useState<TaxonomyRow | null>(null)
  const deleteTag = useDeleteTag()
  const toggleTagPin = useToggleTagPin()
  const toggleTagHidden = useToggleTagHidden()
  const updateLibraryTag = useUpdateLibraryTag()
  const deleteLibraryTag = useDeleteLibraryTag()

  // Two levels can be lit at once: the library row says which library is in
  // context, the category and tag rows say what is filtered inside it.
  const isUncategorizedActive = !trash && shelfId === 'none'
  // The empty hint only describes a bare section: no shelf row and no
  // uncategorized row. Any visible row already answers "where are my books".
  const uncategorizedRowVisible = isUncategorizedActive || (uncategorizedCount ?? 0) > 0
  const isShelvesLoading = Boolean(
    (inLibrary ? categoriesQuery.isLoading || libraryUncategorizedLoading : shelvesLoading || uncategorizedLoading)
    && !isUncategorizedActive,
  )
  // Curating a taxonomy is the library owner's call, never the reader's: a
  // private library is its owner's, a shared one needs owner/admin.
  const canEditShelves = inLibrary ? canCurate : !readOnly
  const canEditTags = inLibrary ? canCurate : !readOnly

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
        <BookdockLogo className="h-8 w-8 shrink-0 text-stone-900 dark:text-stone-50" />
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
        <LibrarySection
          libraries={libraries ?? []}
          activeLibraryId={activeLibraryId}
          isFilterActive={Boolean(shelfId || tagId || trash)}
          onSelect={onSelectLibrary}
          onSelectPrivate={() => {
            // One navigation, not two: the second would be built from the URL
            // state this one is still replacing and would put the library id
            // back, so the reader could never leave a shared library.
            onSelectLibrary?.(null)
            onMobileClose?.()
          }}
          onPrefetchPrivate={() => onPrefetchNavigation?.({ shelf: undefined, tag: undefined, status: undefined, trash: undefined }, null)}
          onManage={onManageLibrary}
          onRenamePrivate={setRenamePrivateTarget}
          onJoin={onJoinLibrary}
          onExplore={onExploreLibraries}
          disabled={readOnly}
        />
        {/* A read-only taxonomy with uncategorized books still offers the
            uncategorized row; without it those books lose their sidebar entry. */}
        {(canEditShelves || isShelvesLoading || shelves.length > 0 || uncategorizedRowVisible) && (
          <>
            <div className="mb-1 mt-6 flex items-center justify-between px-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-400">
                {_(inLibrary ? 'library.categories' : 'library.shelves')}
              </span>
              {canEditShelves && (
                <button
                  type="button"
                  onClick={() => setShelfDialog({})}
                  className="-mr-[3px] flex h-5 w-5 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  title={_(inLibrary ? 'library.newCategory' : 'library.newShelf')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
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
                        readOnly={!canEditShelves}
                        onClick={() => selectNavigation({ shelf: shelf.id, tag: undefined, status: undefined, trash: undefined })}
                        onPointerEnter={() => onPrefetchNavigation?.({ shelf: shelf.id, tag: undefined, status: undefined, trash: undefined })}
                        onRename={() => setShelfDialog({ shelfId: shelf.id, initialName: shelf.name })}
                        onDelete={() => setDeleteShelfTarget(shelf)}
                        onTogglePin={() => (activeLibraryId
                          ? updateLibraryCategory.mutate({ libraryId: activeLibraryId, categoryId: shelf.id, patch: { pinned: !shelf.pinned } })
                          : toggleShelfPin.mutate({ id: shelf.id, pinned: !shelf.pinned }))}
                        onToggleHidden={() => (activeLibraryId
                          ? updateLibraryCategory.mutate({ libraryId: activeLibraryId, categoryId: shelf.id, patch: { hidden: !shelf.hidden } })
                          : toggleShelfHidden.mutate({ id: shelf.id, hidden: !shelf.hidden }))}
                      />
                    ))}
                  </SortableContext>
                ) : (!uncategorizedRowVisible && (
                  <div className="px-3 py-1 text-xs text-stone-400">{_(inLibrary ? 'library.noCategories' : 'library.noShelves')}</div>
                ))}
              </>
            )}
          </>
        )}

        {(canEditTags || taxonomyLoading || tags.length > 0) && (
          <>
            <div className="mb-1 mt-6 flex items-center justify-between px-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-400">
                {_('library.tags')}
              </span>
              {canEditTags && (
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
              )}
            </div>
            {(inLibrary ? libraryTagsQuery.isLoading : tagsLoading) ? (
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
                    readOnly={!canEditTags}
                    active={!trash && tagId === tag.id}
                    onClick={() => selectNavigation({ tag: tag.id, shelf: undefined, status: undefined, trash: undefined })}
                    onPointerEnter={() => onPrefetchNavigation?.({ tag: tag.id, shelf: undefined, status: undefined, trash: undefined })}
                    onRename={() => setTagDialog({ tagId: tag.id, initialName: tag.name })}
                    onDelete={() => setDeleteTagTarget(tag)}
                    onTogglePin={() => (activeLibraryId
                      ? updateLibraryTag.mutate({ libraryId: activeLibraryId, tagId: tag.id, patch: { pinned: !tag.pinned } })
                      : toggleTagPin.mutate({ id: tag.id, pinned: !tag.pinned }))}
                    onToggleHidden={() => (activeLibraryId
                      ? updateLibraryTag.mutate({ libraryId: activeLibraryId, tagId: tag.id, patch: { hidden: !tag.hidden } })
                      : toggleTagHidden.mutate({ id: tag.id, hidden: !tag.hidden }))}
                  />
                ))}
              </SortableContext>
            )}
          </>
        )}

        {/* The private trash lives outside any library; a shared library
            offers its own owner-only trash row while in context. */}
        {trashEnabled && !readOnly && !inLibrary && (
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
        {sharedTrashVisible && libraryTrashEnabled && (
          <div className="mt-6 border-t border-stone-200/60 pt-4 dark:border-stone-800/50">
            <NavItem
              label={_('library.trash')}
              count={libraryTrashCount}
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
        {!readOnly && <NavItem
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
        />}
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
        libraryId={activeLibraryId ?? undefined}
        shelfId={shelfDialog?.shelfId}
        initialName={shelfDialog?.initialName}
        onClose={() => setShelfDialog(null)}
      />

      <TagDialog
        open={tagDialog !== null}
        libraryId={activeLibraryId ?? undefined}
        tagId={tagDialog?.tagId}
        initialName={tagDialog?.initialName}
        onClose={() => setTagDialog(null)}
      />

      {renamePrivateTarget && (
        <PrivateLibraryRenameDialog
          library={libraries?.find((library) => library.id === renamePrivateTarget.id) ?? renamePrivateTarget}
          onClose={() => setRenamePrivateTarget(null)}
        />
      )}

      {deleteShelfTarget && (
        <ConfirmDialog
          title={_(inLibrary ? 'library.deleteCategory' : 'library.deleteShelf')}
          message={_(inLibrary ? 'library.deleteCategoryConfirm' : 'library.deleteShelfConfirm', { name: deleteShelfTarget.name })}
          confirmLabel={_('reader.delete')}
          confirmVariant="danger"
          onClose={() => setDeleteShelfTarget(null)}
          onConfirm={() => {
            const target = deleteShelfTarget
            setDeleteShelfTarget(null)
            if (shelfId === target.id) selectNavigation({ shelf: undefined, tag: undefined, status: undefined, trash: undefined })
            if (activeLibraryId) void deleteLibraryCategory.mutateAsync({ libraryId: activeLibraryId, categoryId: target.id }).catch(() => undefined)
            else void deleteShelf.mutateAsync(target.id).catch(() => undefined)
          }}
        />
      )}

      {deleteTagTarget && (
        <ConfirmDialog
          title={_('library.deleteTag')}
          message={_('library.deleteTagConfirm', { name: deleteTagTarget.name })}
          confirmLabel={_('reader.delete')}
          confirmVariant="danger"
          onClose={() => setDeleteTagTarget(null)}
          onConfirm={() => {
            const target = deleteTagTarget
            setDeleteTagTarget(null)
            if (tagId === target.id) selectNavigation({ shelf: undefined, tag: undefined, status: undefined, trash: undefined })
            if (activeLibraryId) void deleteLibraryTag.mutateAsync({ libraryId: activeLibraryId, tagId: target.id }).catch(() => undefined)
            else void deleteTag.mutateAsync(target.id).catch(() => undefined)
          }}
        />
      )}
      </aside>
    </>
  )
})

export default LibrarySidebar

/**
 * Library switcher (0.4.0). One row per library the reader can see, with their
 * own private library first. It sits in the sidebar rather than above the book
 * list so that switching libraries feels like picking a shelf: the rows below
 * it - categories and tags - then describe whichever library is in context.
 *
 * The private row uses its persisted name or the localized default.
 */
function CompassIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  )
}

const MENU_ICON = 'shrink-0 text-stone-400'

function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={MENU_ICON} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={MENU_ICON} aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={MENU_ICON} aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function JoinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={MENU_ICON} aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={MENU_ICON} aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={MENU_ICON} aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  )
}

function LibrarySection({
  libraries, activeLibraryId, isFilterActive = false, onSelect, onSelectPrivate, onPrefetchPrivate, onManage, onRenamePrivate, onJoin, onExplore, disabled,
}: {
  libraries: LibraryListItem[]
  activeLibraryId: string | null
  isFilterActive?: boolean
  onSelect?: (libraryId: string | null) => void
  /** Leaving library context also drops shelf/tag/status filters, as before. */
  onSelectPrivate?: () => void
  onPrefetchPrivate?: () => void
  onManage?: (library: LibraryListItem) => void
  onRenamePrivate?: (library: LibraryListItem) => void
  onJoin?: (library: LibraryListItem) => void
  onExplore?: () => void
  disabled?: boolean
}) {
  const _ = useTranslation()
  // Only libraries the reader belongs to are listed here: discoverable but
  // unjoined libraries live in the settings library list's future discovery
  // home, not in the daily switching rows.
  const prefs = useLibraryPrefs()
  const { isHidden } = useHiddenLibraries()
  const [detailsTarget, setDetailsTarget] = useState<LibraryListItem | null>(null)
  const shared = useMemo(() => applyLibraryOrder(
    libraries.filter((library) => library.type === 'shared'
      && (library.relation === 'owner' || library.relation === 'admin' || library.relation === 'member')
      && !isHidden(library.id)),
    prefs?.libraryOrder,
  ), [libraries, isHidden, prefs?.libraryOrder])
  const privateLibrary = libraries.find((library) => library.type === 'private')
  if (shared.length === 0 && !onExplore) return null
  const privateActive = activeLibraryId === null
  const activeVariant: 'primary' | 'scope' = isFilterActive ? 'scope' : 'primary'

  return (
    <>
      {privateLibrary && !disabled ? (
        <LibraryRow
          library={privateLibrary}
          active={privateActive}
          activeVariant={privateActive ? activeVariant : 'primary'}
          onSelect={onSelectPrivate ?? (() => onSelect?.(null))}
          onPointerEnter={onPrefetchPrivate}
          onRename={onRenamePrivate ? () => onRenamePrivate(privateLibrary) : undefined}
        />
      ) : (
        <NavItem
          label={privateLibrary?.name || _(disabled ? 'library.allBooks' : 'library.myLibrary')}
          active={privateActive}
          activeVariant={privateActive ? activeVariant : 'primary'}
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a4 4 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a4 4 0 0 1 3-3h7z" />
            </svg>
          }
          onClick={onSelectPrivate ?? (() => onSelect?.(null))}
          onPointerEnter={onPrefetchPrivate}
        />
      )}
      {shared.length > 1 ? (
        <SortableContext items={shared.map((library) => library.id)} strategy={verticalListSortingStrategy}>
          {shared.map((library) => {
            const isActive = activeLibraryId === library.id
            return (
              <LibraryRow
                key={library.id}
                library={library}
                active={isActive}
                activeVariant={isActive ? activeVariant : 'primary'}
                disabled={disabled}
                relation={library.relation}
                onSelect={() => onSelect?.(library.id)}
                onManage={onManage ? () => onManage(library) : undefined}
                onJoin={onJoin ? () => onJoin(library) : undefined}
                onShowDetails={() => setDetailsTarget(library)}
              />
            )
          })}
        </SortableContext>
      ) : (
        shared.map((library) => {
          const isActive = activeLibraryId === library.id
          return (
            <LibraryRow
              key={library.id}
              library={library}
              active={isActive}
              activeVariant={isActive ? activeVariant : 'primary'}
              disabled={disabled}
              relation={library.relation}
              onSelect={() => onSelect?.(library.id)}
              onManage={onManage ? () => onManage(library) : undefined}
              onJoin={onJoin ? () => onJoin(library) : undefined}
              onShowDetails={() => setDetailsTarget(library)}
            />
          )
        })
      )}
      {detailsTarget && (
        <LibraryDetailsDialog library={detailsTarget} onClose={() => setDetailsTarget(null)} />
      )}
      {onExplore && (
        <button
          type="button"
          onClick={onExplore}
          disabled={disabled}
          className="group mt-0.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 cursor-pointer"
        >
          <CompassIcon className="h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform group-hover:scale-110 group-hover:text-stone-600 dark:group-hover:text-stone-300" />
          <span className="truncate">{_('library.exploreLibraries')}</span>
        </button>
      )}
    </>
  )
}

function LibraryRow({
  library, active, activeVariant = 'primary', disabled, relation, onSelect, onPointerEnter, onManage, onRename, onJoin, onShowDetails,
}: {
  library: LibraryListItem
  active: boolean
  activeVariant?: 'primary' | 'scope'
  disabled?: boolean
  relation?: LibraryRelation
  onSelect: () => void
  onPointerEnter?: () => void
  onManage?: () => void
  onRename?: () => void
  onJoin?: () => void
  onShowDetails?: () => void
}) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const { isHidden, setHidden } = useHiddenLibraries()
  // What a row's menu offers follows from the reader's relation to that
  // library: a non-member can only be let in, a member has nothing to do here,
  // and only an owner or admin has settings to change. The private owner can
  // rename the private library from the same menu — and nothing else, since a
  // one-person library has no roster or owner worth reporting. Hiding is a
  // per-user view preference, so every joined shared library offers it
  // regardless of relation; the personal library is the one row that stays,
  // since it is the way back to your own books.
  const joinable = relation === 'non-member' && (library.visibility === 'public' || library.visibility === 'password')
  const canManageRow = library.type === 'shared' && (relation === 'owner' || relation === 'admin')
  const displayName = library.name || _('library.myLibrary')
  const hidden = isHidden(library.id)
  const menuItems = [
    onShowDetails ? { key: 'details', label: _('library.viewDetails'), icon: <InfoIcon />, run: onShowDetails } : null,
    joinable && onJoin ? { key: 'join', label: _('library.joinLibrary'), icon: <JoinIcon />, run: onJoin } : null,
    canManageRow && onManage ? { key: 'manage', label: _('library.manageLibrary'), icon: <GearIcon />, run: onManage } : null,
    library.type === 'private' && onRename ? { key: 'rename', label: _('library.rename'), icon: <PencilIcon />, run: onRename } : null,
    library.type === 'shared'
      ? { key: 'hidden', label: hidden ? _('library.show') : _('library.hide'), icon: hidden ? <EyeIcon /> : <EyeOffIcon />, run: () => setHidden(library.id, !hidden) }
      : null,
  ].filter((item) => item !== null)
  // Joined shared libraries are the reader's to arrange, so they take the same
  // sortable treatment as shelf and tag rows; the personal library is pinned to
  // the top by design and never moves.
  const sortable = library.type === 'shared' && !disabled
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: library.id,
    data: { type: 'library' },
    disabled: !sortable,
    animateLayoutChanges: () => false,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }}
      className={cn('group relative', isDragging && 'relative z-20 opacity-70')}
      onContextMenu={!disabled ? (e) => {
        e.preventDefault()
        e.stopPropagation()
        menu.openFromEvent(e)
      } : undefined}
    >
      <NavItem
        label={displayName}
        active={active}
        activeVariant={activeVariant}
        countHidden={!disabled && menu.open}
        hasMenu={!disabled}
        dragHandleProps={sortable ? { ...attributes, ...listeners } : undefined}
        icon={library.type === 'private' ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a4 4 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a4 4 0 0 1 3-3h7z" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        )}
        onClick={onSelect}
        onPointerEnter={onPointerEnter}
      />
      {!disabled && (
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
          </button>
          {menu.open && (
            <SmartMenu triggerRef={menu.btnRef} innerRef={menu.menuRef} position={menu.position(152, 258)} onClose={menu.close} width={152}>
              <div className="mx-1.5 mb-1 border-b border-stone-100 px-1.5 pb-2 pt-1.5 dark:border-stone-800">
                <p className="truncate text-xs font-medium text-stone-900 dark:text-stone-100">{displayName}</p>
                {library.type === 'shared' && <p className="mt-0.5 text-[10px] text-stone-400 dark:text-stone-500">
                  {_(`library.visibility${library.visibility === 'public' ? 'Public' : library.visibility === 'password' ? 'Password' : 'Private'}`)}
                </p>}
              </div>
              {menuItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    menu.close()
                    item.run()
                  }}
                  className={cn(libraryMenuItemClass, 'w-full text-left')}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </SmartMenu>
          )}
        </div>
      )}
    </div>
  )
}

function NavItem({
  label,
  count,
  countHidden = false,
  hasMenu = false,
  active = false,
  activeVariant = 'primary',
  icon,
  badge,
  onClick,
  onPointerEnter,
  // dnd-kit's attributes/listeners. NavItem renders its own button rather than
  // spreading unknown props, so a draggable row has to hand them over explicitly
  // — dropping them here silently disables dragging.
  dragHandleProps,
}: {
  label: string
  count?: number
  countHidden?: boolean
  hasMenu?: boolean
  active?: boolean
  activeVariant?: 'primary' | 'scope'
  icon?: React.ReactNode
  /** Trailing mark inside the label run (the taxonomy hidden badge). */
  badge?: React.ReactNode
  onClick: () => void
  onPointerEnter?: () => void
  dragHandleProps?: Record<string, unknown>
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      {...dragHandleProps}
      className={cn(
        'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-all',
        hasMenu && 'pr-10 md:pr-3',
        active
          ? activeVariant === 'scope'
            ? 'bg-stone-200/50 font-medium text-stone-900 hover:bg-stone-200/75 dark:bg-stone-800/50 dark:text-stone-100 dark:hover:bg-stone-800/75'
            : 'bg-white font-medium text-stone-900 shadow-sm ring-1 ring-stone-200/70 dark:bg-stone-800 dark:text-stone-50 dark:ring-stone-700/60 dark:shadow-xs'
          : 'text-stone-500 hover:bg-stone-200/50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/50 dark:hover:text-stone-100',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {icon && (
          <span
            className={cn(
              'shrink-0 transition-colors',
              active
                ? activeVariant === 'scope'
                  ? 'text-stone-600 dark:text-stone-300'
                  : 'text-stone-700 dark:text-stone-200'
                : 'text-stone-400 dark:text-stone-500',
            )}
          >
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {badge}
        {count !== undefined && (
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums transition-all',
              hasMenu && 'group-hover:opacity-0',
              countHidden && 'opacity-0',
              active
                ? activeVariant === 'scope'
                  ? 'bg-stone-200/80 text-stone-700 dark:bg-stone-700/50 dark:text-stone-300'
                  : 'bg-stone-100 text-stone-700 dark:bg-stone-700/60 dark:text-stone-200'
                : 'text-stone-400 bg-stone-200/40 group-hover:bg-stone-200/70 group-hover:text-stone-600 dark:text-stone-400 dark:bg-stone-900/60 dark:group-hover:bg-stone-800/70 dark:group-hover:text-stone-300',
            )}
          >
            {count}
          </span>
        )}
      </span>
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

/**
 * One taxonomy row, whichever library it came from. A private shelf is a
 * LibraryBook.categoryId and a shared library's category is the same table scoped
 * by libraryId, so the two response shapes are the same shape - including the
 * book count, which the server reports for both.
 */
interface TaxonomyRow {
  id: string
  name: string
  pinned: boolean
  hidden: boolean
  bookCount: number
}

function ShelfItem({
  shelf,
  active,
  settling,
  onClick,
  onPointerEnter,
  onRename,
  onDelete,
  onTogglePin,
  onToggleHidden,
  readOnly = false,
}: {
  shelf: TaxonomyRow
  active: boolean
  settling: boolean
  onClick: () => void
  onPointerEnter?: () => void
  onRename: () => void
  onDelete: () => void
  onTogglePin: () => void
  onToggleHidden: () => void
  readOnly?: boolean
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
    disabled: readOnly,
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
      onContextMenu={!readOnly ? (e) => {
        e.preventDefault()
        e.stopPropagation()
        menu.openFromEvent(e)
      } : undefined}
      title={shelf.hidden ? _('library.catalogUnlisted') : undefined}
    >
      <NavItem
        label={shelf.name}
        count={shelf.bookCount}
        countHidden={!readOnly && menu.open}
        badge={shelf.hidden ? <HiddenIndicator kind="work" /> : undefined}
        hasMenu={!readOnly}
        active={active || dropHint}
        icon={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        }
        onClick={onClick}
        onPointerEnter={onPointerEnter}
      />
      {!readOnly && <div className="absolute right-2 top-1/2 -translate-y-1/2">
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
      </div>}
      {!readOnly && <SmartMenu triggerRef={menu.btnRef} innerRef={menu.menuRef} position={menu.position(152, 186)} onClose={menu.close} width={152}>
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
            onTogglePin()
          }}
          className={shelfMenuItemClass}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
          {shelf.pinned ? _('library.unpin') : _('library.pin')}
        </button>
        <button
          type="button"
          onClick={() => {
            menu.close()
            onToggleHidden()
          }}
          className={shelfMenuItemClass}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            {shelf.hidden ? (
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
          {shelf.hidden ? _('library.show') : _('library.hide')}
        </button>
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
      </SmartMenu>}
    </div>
  )
}

const shelfMenuItemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'
const libraryMenuItemClass = shelfMenuItemClass

function TagItem({
  tag,
  settling,
  active,
  onClick,
  onPointerEnter,
  onRename,
  onDelete,
  onTogglePin,
  onToggleHidden,
  readOnly = false,
}: {
  tag: TaxonomyRow
  settling: boolean
  active: boolean
  onClick: () => void
  onPointerEnter?: () => void
  onRename: () => void
  onDelete: () => void
  onTogglePin: () => void
  onToggleHidden: () => void
  readOnly?: boolean
}) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tag.id,
    data: { type: 'tag' },
    disabled: readOnly,
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
      onContextMenu={!readOnly ? (e) => {
        e.preventDefault()
        e.stopPropagation()
        menu.openFromEvent(e)
      } : undefined}
      title={tag.hidden ? _('library.catalogUnlisted') : undefined}
    >
      <NavItem
        label={tag.name}
        count={tag.bookCount}
        countHidden={!readOnly && menu.open}
        hasMenu={!readOnly}
        badge={tag.hidden ? <HiddenIndicator kind="work" /> : undefined}
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
      {!readOnly && <div className="absolute right-2 top-1/2 -translate-y-1/2">
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
      </div>}
      {!readOnly && <SmartMenu triggerRef={menu.btnRef} innerRef={menu.menuRef} position={menu.position(152, 186)} onClose={menu.close} width={152}>
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
            onTogglePin()
          }}
          className={shelfMenuItemClass}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
          {tag.pinned ? _('library.unpin') : _('library.pin')}
        </button>
        <button
          type="button"
          onClick={() => {
            menu.close()
            onToggleHidden()
          }}
          className={shelfMenuItemClass}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            {tag.hidden ? (
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
          {tag.hidden ? _('library.show') : _('library.hide')}
        </button>
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
      </SmartMenu>}
    </div>
  )
}

function BookdockLogo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
    </svg>
  )
}
