import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { useDndContext, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'

import type { Category, LibraryListItem, LibraryRelation } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'

import type { LibrarySearch } from '@/routes/index'
import SmartMenu from '@/components/ui/SmartMenu'
import { archiveEntryState } from '@/features/archive/archive-return'
import AccountMenu from '@/features/auth/AccountMenu'
import NotificationBell from '@/features/notifications/components/NotificationBell'
import { applyLibraryOrder, applyShelfOrder, applyTagOrder, isBookDrag, SHELF_NONE_DROPPABLE } from '../dnd'
import { sortSidebarItems } from '../sort-modes'
import { sortCategories } from '../taxonomy'
import { useBooks, useShelves, useTags, useDeleteShelf, useDeleteTag, useToggleShelfPin, useToggleShelfHidden, useToggleTagPin, useToggleTagHidden, useTrashEnabled, useLibraryPrefs, useLibraryPrefsState, useHiddenLibraries, useLibraryCategories, useLibraryTags, useLibraryCatalog, useLibraryRelation, useUpdateLibraryCategory, useDeleteLibraryCategory, useUpdateLibraryTag, useDeleteLibraryTag } from '../hooks'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import TaxonomyEntry from './TaxonomyEntry'
import TaxonomyEmptyState from './TaxonomyEmptyState'
import TaxonomyIcon from './TaxonomyIcon'
import { MenuHeader } from './RowMenuChrome'
import LibraryDetailsDialog from './LibraryDetailsDialog'
import ShelfDialog from './ShelfDialog'
import TagDialog from './TagDialog'
import PrivateLibraryRenameDialog from './PrivateLibraryRenameDialog'
import { useContextMenu } from './use-context-menu'

const navigationSessions = new Map<string, { panel: 'shelves' | 'categories' | 'tags'; expanded: string[]; scroll: Record<string, number> }>()
const EMPTY_CATEGORIES: Category[] = []

interface LibrarySidebarProps {
  sessionKey?: string
  navSearch: (patch: Partial<LibrarySearch>) => void
  onPrefetchNavigation?: (patch: Partial<LibrarySearch>, targetLibraryId?: string | null) => void
  shelfId: string | null
  categoryId: string | null
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
  /** Active directory view panel ('categories' | 'tags'), if currently browsing directory */
  directory?: 'shelves' | 'categories' | 'tags'
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
  privateLibraryId?: string | null
  activeLibraryName?: string
  activeLibraryNameLoading?: boolean
  librariesResolved?: boolean
  onSelectLibrary?: (libraryId: string | null) => void
  onManageLibrary?: (library: LibraryListItem) => void
  /** Opens the join flow for a library the reader can see but has not joined. */
  onJoinLibrary?: (library: LibraryListItem) => void
  /** Opens the discovery dialog showing all public and password libraries. */
  onExploreLibraries?: () => void
  onOpenNotifications?: () => void
  notificationButtonRef?: React.RefObject<HTMLButtonElement | null>
  /**
   * Current library search, used once when entering the archive: the archive
   * top bar exits back to this exact state. Optional so older call sites keep
   * the previous plain navigation.
   */
  librarySearch?: LibrarySearch
}

const LibrarySidebar = memo(function LibrarySidebar({ sessionKey = '', navSearch, onPrefetchNavigation, shelfId, categoryId, tagId, trash, directory, readOnly = false, mobileOpen = false, onMobileClose, navRef, shelfOrderOverride, settleShelfId, tagOrderOverride, settleTagId, libraries, activeLibraryId = null, privateLibraryId = null, activeLibraryName, activeLibraryNameLoading = false, librariesResolved = true, onSelectLibrary, onManageLibrary, onJoinLibrary, onExploreLibraries, onOpenNotifications, notificationButtonRef, librarySearch }: LibrarySidebarProps) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const [session, setSession] = useState(() => (sessionKey ? navigationSessions.get(sessionKey) : undefined) ?? { panel: (directory || (activeLibraryId ? 'categories' : 'shelves')) as 'shelves' | 'categories' | 'tags', expanded: [] as string[], scroll: {} as Record<string, number> })
  const panel = session.panel
  const remember = useCallback((patch: Partial<typeof session>) => setSession((previous) => {
    const next = { ...previous, ...patch }; navigationSessions.set(sessionKey, next); return next
  }), [sessionKey])

  useEffect(() => {
    if (activeLibraryId && panel === 'shelves') remember({ panel: 'categories' })
  }, [activeLibraryId, panel, remember])
  useEffect(() => {
    if (directory && directory !== panel && (activeLibraryId || directory !== 'shelves')) {
      remember({ panel: directory })
    }
  }, [directory, panel, activeLibraryId, remember])
  const { data: shelvesData, isLoading: shelvesLoading, isError: shelvesError, refetch: refetchShelves } = useShelves()
  const { data: tagsData, isLoading: tagsLoading, isError: tagsError, refetch: refetchTags } = useTags()
  // Shared libraries expose their categories here; private shelves and private
  // categories stay independent and load from their respective endpoints.
  const inLibrary = activeLibraryId !== null
  const taxonomyLibraryId = activeLibraryId ?? privateLibraryId
  const categoriesQuery = useLibraryCategories(taxonomyLibraryId)
  const libraryTagsQuery = useLibraryTags(activeLibraryId)
  const relationQuery = useLibraryRelation(activeLibraryId)
  const canCurate = inLibrary
    && (relationQuery.data?.data.relation === 'owner' || relationQuery.data?.data.relation === 'admin')
  const libraryPrefs = useLibraryPrefs()

  // Auto modes re-sort the full list client-side over the server (manual)
  // order; the same memo exists in Library for the drag materialization. Both
  // taxonomies satisfy SidebarSortableItem, so the preference applies to either.
  const shelfRows = useMemo(() => sortSidebarItems(applyShelfOrder(shelvesData?.data ?? [], shelfOrderOverride), libraryPrefs?.shelfSort), [shelvesData, shelfOrderOverride, libraryPrefs?.shelfSort])
  const categories = categoriesQuery.data?.data ?? EMPTY_CATEGORIES
  const categoryRows = useMemo(() => sortCategories(applyShelfOrder(categories, shelfOrderOverride), libraryPrefs?.shelfSort), [categories, shelfOrderOverride, libraryPrefs?.shelfSort])
  const shelves = panel === 'categories' ? categoryRows : shelfRows
  const autoExpandedSelection = useRef('')
  useEffect(() => {
    const selected = categoriesQuery.data?.data.find((category) => category.id === categoryId)
    if (!selected) {
      if (!categoryId) autoExpandedSelection.current = ''
      return
    }
    const key = `${sessionKey}:${categoryId}`
    if (autoExpandedSelection.current === key) return
    autoExpandedSelection.current = key
    const parent = selected.parentId ?? (categoriesQuery.data?.data.some((category) => category.parentId === selected.id) ? selected.id : undefined)
    // Category refreshes must not undo an explicit collapse.
    if (parent) setSession((previous) => {
      if (previous.expanded.includes(parent)) return previous
      const next = { ...previous, expanded: [...previous.expanded, parent] }
      navigationSessions.set(sessionKey, next)
      return next
    })
  }, [categoriesQuery.data, categoryId, sessionKey])
  const tags = useMemo(
    () => sortSidebarItems(
      applyTagOrder(inLibrary ? (libraryTagsQuery.data?.data ?? []) : (tagsData?.data ?? []), tagOrderOverride),
      libraryPrefs?.tagSort,
    ),
    [inLibrary, libraryTagsQuery.data, tagsData, tagOrderOverride, libraryPrefs?.tagSort],
  )
  const taxonomyLoading = panel === 'categories' ? categoriesQuery.isLoading : panel === 'shelves' ? shelvesLoading : (inLibrary ? libraryTagsQuery.isLoading : tagsLoading)
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

  const { data: allBooksData } = useBooks({
    page: 1,
    pageSize: 1,
    search: '',
    sortBy: 'createdAt',
    sortOrder: 'desc',
    shelfId: null,
    tagId: null,
    format: null,
    readStatus: null,
    trash: false,
    showHidden: revealHidden,
  }, { enabled: !inLibrary })
  const { data: libraryAllBooksData } = useLibraryCatalog(
    activeLibraryId,
    { page: 1, pageSize: 1, trash: false },
  )
  const allBooksCount = inLibrary ? libraryAllBooksData?.data.total : allBooksData?.total

  // The uncategorized count is a per-view badge, so it is asked of whichever
  // list is in context: a private library's books, or the shared catalog's
  // works filed under no category.
  const { data: uncategorizedData } = useBooks({
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
  const { data: libraryUncategorizedData } = useLibraryCatalog(
    activeLibraryId,
    { page: 1, pageSize: 1, categoryId: 'none' },
  )
  const uncategorizedCount = inLibrary ? libraryUncategorizedData?.data.total : uncategorizedData?.total
  const { data: unclassifiedData } = useBooks({ page: 1, pageSize: 1, search: '', sortBy: 'createdAt', sortOrder: 'desc', shelfId: null, categoryId: 'none', tagId: null, format: null, readStatus: null, trash: false, showHidden: revealHidden }, { enabled: !inLibrary })
  const unclassifiedCount = inLibrary ? uncategorizedCount : unclassifiedData?.total

  const [shelfDialog, setShelfDialog] = useState<{ shelfId?: string; initialName?: string; initialParentId?: string } | null>(null)
  const [deleteShelfTarget, setDeleteShelfTarget] = useState<TaxonomyRow | null>(null)
  const [deletingPending, setDeletingPending] = useState(false)
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
  const isUncategorizedActive = !trash && (inLibrary ? categoryId === 'none' : panel === 'categories' ? categoryId === 'none' : shelfId === 'none')
  // The empty hint only describes a bare section: no shelf row and no
  // uncategorized row. Any visible row already answers "where are my books".

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

  useEffect(() => {
    const element = localNavRef.current
    if (element) element.scrollTop = navigationSessions.get(sessionKey)?.scroll[panel] ?? 0
    updateScrollShadows()
  }, [panel, sessionKey, updateScrollShadows])
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
    navSearch({ ...patch, directory: undefined })
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
        'w-60 shrink-0 flex-col border-r border-stone-200/60 px-3 pt-5 pb-3 md:sticky md:top-0 md:h-screen md:self-start dark:border-stone-800/50',
        mobileOpen
          ? 'fixed inset-y-0 left-0 z-50 flex h-full w-[min(19rem,75vw)] overflow-hidden bg-stone-50 shadow-xl dark:bg-stone-950 md:shadow-none'
          : 'hidden md:flex',
      )}>
      <div className="mb-5 flex items-center justify-between gap-2 px-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <BookdockLogo className="h-8 w-8 shrink-0 text-stone-900 dark:text-stone-50" />
          <span className="truncate font-serif text-base font-semibold tracking-wide text-stone-900 dark:text-stone-50">{_('app.name')}</span>
        </div>
        <NotificationBell
          buttonRef={notificationButtonRef}
          onOpen={onOpenNotifications}
          className="h-8 w-8"
        />
      </div>

      <LibrarySection
        libraries={libraries ?? []} activeLibraryId={activeLibraryId}
        activeLibraryName={activeLibraryName}
        activeNameLoading={activeLibraryNameLoading}
        namesReady={librariesResolved}
        onSelect={(id) => { onSelectLibrary?.(id); onMobileClose?.() }}
        onSelectPrivate={() => { onSelectLibrary?.(null); onMobileClose?.() }}
        onPrefetchPrivate={() => onPrefetchNavigation?.({ shelf: undefined, tag: undefined, status: undefined, trash: undefined }, null)}
        onManage={onManageLibrary} onRenamePrivate={setRenamePrivateTarget} onJoin={onJoinLibrary}
        onExplore={() => { onExploreLibraries?.(); onMobileClose?.() }} disabled={readOnly}
      />
      <div className="flex flex-col gap-1">
        <NavItem
          label={_('library.allBooks')}
          count={allBooksCount}
          active={!trash && !shelfId && !categoryId && !tagId}
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a4 4 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a4 4 0 0 1 3-3h7z" />
            </svg>
          }
          onClick={() => selectNavigation({ expression: undefined, shelf: undefined, category: undefined, tag: undefined, q: undefined, format: undefined, status: undefined, author: undefined, series: undefined, categoryScope: undefined, trash: undefined })}
        />
        {panel === 'shelves' && <UncategorizedDropTarget label={_('library.notOnShelf')} count={uncategorizedCount} active={isUncategorizedActive}
          onClick={() => selectNavigation({ shelf: 'none', category: undefined, tag: undefined, categoryScope: undefined, trash: undefined })}
          onPointerEnter={() => onPrefetchNavigation?.({ shelf: 'none', category: undefined, tag: undefined, categoryScope: undefined, trash: undefined })} />}
        {panel === 'categories' && <NavItem label={_('library.uncategorized')} count={inLibrary ? uncategorizedCount : unclassifiedCount} active={isUncategorizedActive}
          icon={<TaxonomyIcon kind="category" size={15} />}
          onClick={() => selectNavigation({ category: 'none', shelf: undefined, tag: undefined, categoryScope: 'subtree', trash: undefined })}
          onPointerEnter={() => onPrefetchNavigation?.({ category: 'none', shelf: undefined, tag: undefined, categoryScope: 'subtree', trash: undefined })} />}
        {((trashEnabled && !readOnly && !inLibrary) || (sharedTrashVisible && libraryTrashEnabled)) && (
          <NavItem
            label={_('library.trash')}
            count={inLibrary ? libraryTrashCount : trashCount}
            active={trash}
            icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            }
            onClick={() => selectNavigation({ trash: true, shelf: undefined, category: undefined, tag: undefined, status: undefined, categoryScope: undefined })}
          />
        )}
      </div>

      <div className="my-2.5 border-t border-stone-200/60 dark:border-stone-800/60" />

      <div className="mb-1 flex min-w-0 items-center gap-2 px-0.5">
        <div className="inline-flex h-7 min-w-0 flex-1 items-center rounded-lg border border-stone-200/60 bg-stone-200/50 p-0.5 dark:border-stone-700/50 dark:bg-stone-800/60">
          {(inLibrary ? ['categories', 'tags'] as const : ['shelves', 'categories', 'tags'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={panel === value}
              onClick={() => {
                const scroll = { ...(navigationSessions.get(sessionKey)?.scroll ?? session.scroll), [panel]: localNavRef.current?.scrollTop ?? 0 }
                remember({ panel: value, scroll })
                if (directory) {
                  navSearch({ directory: value })
                }
              }}
              className={cn(
                'flex h-full min-w-0 flex-auto items-center justify-center rounded-[6px] px-1 text-xs whitespace-nowrap transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 cursor-pointer',
                panel === value
                  ? 'bg-white font-semibold text-stone-900 shadow-xs ring-1 ring-stone-200/70 dark:bg-stone-700 dark:text-stone-100 dark:ring-white/10'
                  : 'font-medium text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
              )}
            >
              {_(value === 'tags' ? 'library.tags' : value === 'categories' ? 'library.categories' : 'library.shelves')}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            title={_(panel === 'tags' ? 'library.browseTags' : panel === 'categories' ? 'library.browseCategories' : 'library.browseShelves')}
            aria-label={_(panel === 'tags' ? 'library.browseTags' : panel === 'categories' ? 'library.browseCategories' : 'library.browseShelves')}
            onClick={() => {
              if (directory === panel) {
                navSearch({ directory: undefined })
              } else {
                navSearch({ directory: panel })
              }
              onMobileClose?.()
            }}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg transition-all active:scale-95 cursor-pointer',
              directory === panel
                ? 'bg-white font-medium text-stone-900 shadow-xs ring-1 ring-stone-200/80 dark:bg-stone-800 dark:text-stone-50 dark:ring-stone-700/70'
                : 'text-stone-400 hover:bg-stone-200/60 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
            )}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </button>

          {(panel === 'tags' ? canEditTags : canEditShelves) && (
            <button
              type="button"
              title={_(panel === 'tags' ? 'library.newTag' : panel === 'categories' ? 'library.newCategory' : 'library.newShelf')}
              aria-label={_(panel === 'tags' ? 'library.newTag' : panel === 'categories' ? 'library.newCategory' : 'library.newShelf')}
              onClick={() => {
                if (panel === 'tags') setTagDialog({})
                else setShelfDialog({})
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-all hover:bg-stone-200/60 hover:text-stone-700 active:scale-95 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-pointer"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col -mx-1.5">
        <div data-testid="sidebar-scroll-shadow-top" aria-hidden="true" className={cn('pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-stone-200/80 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-opacity duration-150 dark:bg-stone-800/80', canScrollUp ? 'opacity-100' : 'opacity-0')} />
        <nav ref={setNavRef} onScroll={() => {
          updateScrollShadows()
          navigationSessions.set(sessionKey, { ...session, scroll: { ...(navigationSessions.get(sessionKey)?.scroll ?? session.scroll), [panel]: localNavRef.current?.scrollTop ?? 0 } })
        }} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-y-contain px-1.5 py-1 sidebar-scrollbar">
          {taxonomyLoading ? <div aria-busy="true" className="h-8 animate-pulse rounded-lg bg-stone-200/60 dark:bg-stone-800/60" /> : panel !== 'tags' ? (
            <SortableContext items={shelves.map((shelf) => shelf.id)} strategy={verticalListSortingStrategy}>
              {shelves.filter((shelf) => {
                const parentId = categories.find((category) => category.id === shelf.id)?.parentId
                return !parentId || session.expanded.includes(parentId)
              }).map((shelf) => {
                const category = panel === 'categories' ? categories.find((item) => item.id === shelf.id) : undefined
                const parent = category?.parentId ? categories.find((item) => item.id === category.parentId) : undefined
                const hasChildren = categories.some((item) => item.parentId === shelf.id)
                const isExpanded = session.expanded.includes(shelf.id)
                return (
                  <TaxonomyEntry
                    key={shelf.id}
                    isCategory={panel === 'categories'}
                    inheritedHidden={Boolean(parent?.hidden)}
                    row={{ ...shelf, bookCount: category && !category.parentId ? category.subtreeBookCount ?? shelf.bookCount : shelf.bookCount }}
                    active={!trash && (panel === 'categories' ? categoryId : shelfId) === shelf.id}
                    settling={settleShelfId === shelf.id}
                    readOnly={!canEditShelves}
                    isExpanded={hasChildren ? isExpanded : undefined}
                    indent={Boolean(category?.parentId)}
                    onOpen={() => {
                      if (hasChildren && !isExpanded) remember({ expanded: [...session.expanded, shelf.id] })
                      selectNavigation(panel === 'categories'
                        ? { category: shelf.id, shelf: undefined, tag: undefined, categoryScope: 'subtree', trash: undefined }
                        : { shelf: shelf.id, category: undefined, tag: undefined, categoryScope: undefined, trash: undefined })
                    }}
                    onClick={() => {
                      if (hasChildren) {
                        if (!trash && !directory && (panel === 'categories' ? categoryId : shelfId) === shelf.id) {
                          remember({ expanded: isExpanded ? session.expanded.filter((id) => id !== shelf.id) : [...session.expanded, shelf.id] })
                          return
                        }
                        if (!isExpanded) remember({ expanded: [...session.expanded, shelf.id] })
                      }
                      selectNavigation(panel === 'categories'
                        ? { category: shelf.id, shelf: undefined, tag: undefined, categoryScope: 'subtree', trash: undefined }
                        : { shelf: shelf.id, category: undefined, tag: undefined, categoryScope: undefined, trash: undefined })
                    }}
                    onPointerEnter={() => onPrefetchNavigation?.(panel === 'categories' ? { category: shelf.id, shelf: undefined, tag: undefined, categoryScope: 'subtree', trash: undefined } : { shelf: shelf.id, category: undefined, tag: undefined, categoryScope: undefined, trash: undefined })}
                    onNewChild={category && !category.parentId ? () => setShelfDialog({ initialParentId: shelf.id }) : undefined}
                    onEdit={() => setShelfDialog({ shelfId: shelf.id, initialName: shelf.name, initialParentId: category?.parentId ?? undefined })}
                    onDelete={() => setDeleteShelfTarget(shelf)}
                    onTogglePin={() => panel === 'categories' ? updateLibraryCategory.mutate({ libraryId: taxonomyLibraryId!, categoryId: shelf.id, patch: { pinned: !shelf.pinned } }) : toggleShelfPin.mutate({ id: shelf.id, pinned: !shelf.pinned })}
                    onToggleHidden={() => panel === 'categories' ? updateLibraryCategory.mutate({ libraryId: taxonomyLibraryId!, categoryId: shelf.id, patch: { hidden: !shelf.hidden } }) : toggleShelfHidden.mutate({ id: shelf.id, hidden: !shelf.hidden })}
                  />
                )
              })}
              {shelves.length === 0 && !(panel === 'categories' ? categoriesQuery.isError && !categoriesQuery.data : shelvesError && !shelvesData) && (
                <TaxonomyEmptyState type={panel} />
              )}
            </SortableContext>
          ) : <SortableContext items={tags.map((tag) => tag.id)} strategy={verticalListSortingStrategy}>
            {tags.map((tag) => <TaxonomyEntry isTag key={tag.id} row={tag} settling={settleTagId === tag.id} readOnly={!canEditTags} active={!trash && tagId === tag.id}
              onClick={() => selectNavigation({ tag: tag.id, shelf: undefined, category: undefined, categoryScope: undefined, trash: undefined })} onPointerEnter={() => onPrefetchNavigation?.({ tag: tag.id, shelf: undefined, category: undefined, categoryScope: undefined, trash: undefined })}
              onEdit={() => setTagDialog({ tagId: tag.id, initialName: tag.name })} onDelete={() => setDeleteTagTarget(tag)}
              onTogglePin={() => activeLibraryId ? updateLibraryTag.mutate({ libraryId: activeLibraryId, tagId: tag.id, patch: { pinned: !tag.pinned } }) : toggleTagPin.mutate({ id: tag.id, pinned: !tag.pinned })}
              onToggleHidden={() => activeLibraryId ? updateLibraryTag.mutate({ libraryId: activeLibraryId, tagId: tag.id, patch: { hidden: !tag.hidden } }) : toggleTagHidden.mutate({ id: tag.id, hidden: !tag.hidden })} />)}
            {tags.length === 0 && !(inLibrary ? libraryTagsQuery.isError && !libraryTagsQuery.data : tagsError && !tagsData) && (
              <TaxonomyEmptyState type="tags" />
            )}
          </SortableContext>}
          {(panel === 'categories' ? categoriesQuery.isError : panel === 'shelves' ? shelvesError : inLibrary ? libraryTagsQuery.isError : tagsError) &&
            <button type="button" onClick={() => panel === 'categories' ? void categoriesQuery.refetch() : panel === 'shelves' ? void refetchShelves() : inLibrary ? void libraryTagsQuery.refetch() : void refetchTags()} className="px-3 py-2 text-xs text-stone-500">{_('library.retryNavigation')}</button>}
        </nav>
        <div data-testid="sidebar-scroll-shadow-bottom" aria-hidden="true" className={cn('pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-stone-50 via-stone-50/70 to-transparent transition-opacity duration-200 dark:from-stone-950 dark:via-stone-950/70', canScrollDown ? 'opacity-100' : 'opacity-0')} />
      </div>

      <div className="mt-auto flex flex-col gap-0.5 pt-2.5 border-t border-stone-200/50 dark:border-stone-800/50">
        {!readOnly && <NavItem
          label={_('archive.title')}
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="m7 14 4-4 4 3 6-6" />
            </svg>
          }
          onClick={() => {
            onMobileClose?.()
            // Record the entry source once: the archive top bar exits back to
            // it no matter how far the reader navigates inside the archive.
            if (librarySearch) {
              void navigate({ to: '/archive', state: (previous) => ({ ...previous, ...archiveEntryState(librarySearch, window.scrollY, previous.archiveReturn) }) })
            } else {
              void navigate({ to: '/archive' })
            }
          }}
          onPointerEnter={() => {
            void import('@/features/archive/Archive')
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
        <AccountMenu />
      </div>

      <ShelfDialog
        open={shelfDialog !== null}
        libraryId={panel === 'categories' ? taxonomyLibraryId ?? undefined : undefined}
        shelfId={shelfDialog?.shelfId}
        initialName={shelfDialog?.initialName}
        initialParentId={shelfDialog?.initialParentId}
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
          title={_(panel === 'categories' ? 'library.deleteCategory' : 'library.deleteShelf')}
          message={_(panel === 'categories' ? 'library.deleteCategoryTreeConfirm' : 'library.deleteShelfConfirm', { name: deleteShelfTarget.name })}
          confirmLabel={_('reader.delete')}
          confirmVariant="danger"
          confirmDisabled={deletingPending}
          onClose={() => { if (!deletingPending) setDeleteShelfTarget(null) }}
          onConfirm={() => {
            if (deletingPending) return
            const target = deleteShelfTarget
            setDeletingPending(true)
            const operation = panel === 'categories' ? deleteLibraryCategory.mutateAsync({ libraryId: taxonomyLibraryId!, categoryId: target.id }) : deleteShelf.mutateAsync(target.id)
            void operation.then(() => {
              setDeleteShelfTarget(null)
              if ((panel === 'categories' ? categoryId : shelfId) === target.id) selectNavigation(panel === 'categories' ? { category: undefined, categoryScope: undefined } : { shelf: undefined })
            }).catch(() => undefined).finally(() => setDeletingPending(false))
          }}
        />
      )}

      {deleteTagTarget && (
        <ConfirmDialog
          title={_('library.deleteTag')}
          message={_('library.deleteTagConfirm', { name: deleteTagTarget.name })}
          confirmLabel={_('reader.delete')}
          confirmVariant="danger"
          confirmDisabled={deletingPending}
          onClose={() => { if (!deletingPending) setDeleteTagTarget(null) }}
          onConfirm={() => {
            if (deletingPending) return
            const target = deleteTagTarget
            setDeletingPending(true)
            const operation = activeLibraryId ? deleteLibraryTag.mutateAsync({ libraryId: activeLibraryId, tagId: target.id }) : deleteTag.mutateAsync(target.id)
            void operation.then(() => {
              setDeleteTagTarget(null)
              if (tagId === target.id) selectNavigation({ tag: undefined })
            }).catch(() => undefined).finally(() => setDeletingPending(false))
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
  libraries, activeLibraryId, activeLibraryName, activeNameLoading, namesReady = true, onSelect, onSelectPrivate, onPrefetchPrivate, onManage, onRenamePrivate, onJoin, onExplore, disabled,
}: {
  libraries: LibraryListItem[]
  activeLibraryId: string | null
  activeLibraryName?: string
  activeNameLoading?: boolean
  namesReady?: boolean
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
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!dropdownRef.current?.contains(event.target as Node) && !(event.target as Element).closest('[data-smart-menu]')) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key) }
  }, [open])
  const _ = useTranslation()
  // Only libraries the reader belongs to are listed here: discoverable but
  // unjoined libraries live in the settings library list's future discovery
  // home, not in the daily switching rows.
  const { prefs } = useLibraryPrefsState()
  const { isHidden, isReady: hiddenReady } = useHiddenLibraries()
  const [detailsTarget, setDetailsTarget] = useState<LibraryListItem | null>(null)
  const shared = useMemo(() => {
    if (!hiddenReady) return []
    return applyLibraryOrder(
      libraries.filter((library) => library.type === 'shared'
        && (library.relation === 'owner' || library.relation === 'admin' || library.relation === 'member')
        && !isHidden(library.id)),
      prefs?.libraryOrder,
    )
  }, [libraries, isHidden, prefs?.libraryOrder, hiddenReady])
  const privateLibrary = libraries.find((library) => library.type === 'private')
  
  const privateActive = activeLibraryId === null
  const activeLibrary = libraries.find((library) => library.id === activeLibraryId)
  const activeIsPrivate = privateActive || activeLibrary?.type === 'private'
  const activeName = activeLibrary?.name || privateLibrary?.name || activeLibraryName || _('library.myLibrary')

  return (
    <div ref={dropdownRef} className="relative mb-3.5">
      <button
        type="button"
        disabled={activeNameLoading || !namesReady}
        aria-label={_('library.switchLibrary')}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'group flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors cursor-pointer select-none',
          'border-stone-200/70 bg-stone-200/35 hover:bg-stone-200/65 dark:border-stone-800/70 dark:bg-stone-800/40 dark:hover:bg-stone-800/70',
          open && 'bg-stone-200/70 border-stone-300/80 dark:bg-stone-800/70 dark:border-stone-700/80',
        )}
      >
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
            activeIsPrivate
              ? 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400'
              : 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400',
          )}
        >
          {activeIsPrivate ? (
            <SolidBookIcon className="h-4 w-4" />
          ) : (
            <SolidGroupIcon className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100 leading-tight">
            {activeNameLoading ? <span data-testid="library-switcher-name-skeleton" aria-hidden="true" className="inline-block h-4 w-28 animate-pulse rounded bg-stone-300/70 align-middle motion-reduce:animate-none dark:bg-stone-700/70" /> : activeName}
          </div>
        </div>
        <svg width="16" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("mr-0.5 shrink-0 transition-colors", open ? "text-stone-700 dark:text-stone-200" : "text-stone-500 group-hover:text-stone-700 dark:text-stone-400 dark:group-hover:text-stone-200")}>
          <path d="m6 8 6-6 6 6" />
          <path d="m6 16 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 rounded-xl border border-stone-200/90 bg-white p-1.5 shadow-lg backdrop-blur-md dark:border-stone-800 dark:bg-stone-900">
          <div className="max-h-[min(24rem,55vh)] overflow-y-auto overscroll-y-contain custom-scrollbar flex flex-col gap-0.5 p-0.5">
            {privateLibrary && !disabled ? (
              <LibraryRow
                library={privateLibrary}
                active={privateActive}
                onSelect={() => { setOpen(false); (onSelectPrivate ?? (() => onSelect?.(null)))() }}
                onPointerEnter={onPrefetchPrivate}
                onRename={onRenamePrivate ? () => onRenamePrivate(privateLibrary) : undefined}
              />
            ) : (
              <button
                type="button"
                onClick={() => { setOpen(false); (onSelectPrivate ?? (() => onSelect?.(null)))() }}
                onPointerEnter={onPrefetchPrivate}
                className={cn(
                  'flex min-h-10 w-full items-center justify-between rounded-lg py-2 pl-3.5 pr-10 text-left text-[13px] transition-colors cursor-pointer',
                  privateActive
                    ? 'bg-stone-100/80 font-semibold text-stone-900 dark:bg-stone-800/70 dark:text-stone-50'
                    : 'text-stone-600 hover:bg-stone-100/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-100',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                    <SolidBookIcon className="h-4 w-4" />
                  </div>
                  <span className="truncate">{privateLibrary?.name || activeLibraryName || _(disabled ? 'library.allBooks' : 'library.myLibrary')}</span>
                </span>
              </button>
            )}
            {!hiddenReady ? (
              <div className="flex flex-col gap-1 p-1">
                <div className="h-9 w-full animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800/60 motion-reduce:animate-none" />
              </div>
            ) : shared.length > 1 ? (
              <SortableContext items={shared.map((library) => library.id)} strategy={verticalListSortingStrategy}>
                {shared.map((library) => {
                  const isActive = activeLibraryId === library.id
                  return (
                    <LibraryRow
                      key={library.id}
                      library={library}
                      active={isActive}
                      disabled={disabled}
                      relation={library.relation}
                      onSelect={() => { setOpen(false); onSelect?.(library.id) }}
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
                    disabled={disabled}
                    relation={library.relation}
                    onSelect={() => { setOpen(false); onSelect?.(library.id) }}
                    onManage={onManage ? () => onManage(library) : undefined}
                    onJoin={onJoin ? () => onJoin(library) : undefined}
                    onShowDetails={() => setDetailsTarget(library)}
                  />
                )
              })
            )}
          </div>

          {onExplore && (
            <div className="mt-1.5 border-t border-stone-200/80 pt-1.5 dark:border-stone-800">
              <button
                type="button"
                onClick={() => { setOpen(false); onExplore?.() }}
                disabled={disabled}
                className="group flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3.5 py-1.5 text-left text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 cursor-pointer"
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center text-stone-400 transition-colors group-hover:text-stone-600 dark:text-stone-500 dark:group-hover:text-stone-300">
                  <CompassIcon className="h-3.5 w-3.5" />
    
            </div>
              <span className="truncate">{_('library.exploreLibraries')}</span>
            </button>
            </div>
          )}
        </div>
      )}
      {detailsTarget && (
        <LibraryDetailsDialog library={detailsTarget} onClose={() => setDetailsTarget(null)} />
      )}
    </div>
  )
}

function LibraryRow({
  library, active, disabled, relation, onSelect, onPointerEnter, onManage, onRename, onJoin, onShowDetails,
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
      {active && (
        <span aria-hidden="true" className="absolute left-1 top-1/2 -translate-y-1/2 h-4 w-1 rounded-full bg-blue-600 dark:bg-blue-400 z-10" />
      )}
      <button
        type="button"
        onClick={onSelect}
        onPointerEnter={onPointerEnter}
        {...(sortable ? { ...attributes, ...listeners } : {})}
        className={cn(
          'flex min-h-10 w-full items-center justify-between rounded-lg py-2 pl-3.5 pr-10 text-left text-[13px] transition-colors cursor-pointer',
          active
            ? 'bg-stone-100/80 font-semibold text-stone-900 dark:bg-stone-800/70 dark:text-stone-50'
            : 'text-stone-600 hover:bg-stone-100/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-100',
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <div className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            library.type === 'private'
              ? 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400'
              : 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400',
          )}>
            {library.type === 'private' ? (
              <SolidBookIcon className="h-4 w-4" />
            ) : (
              <SolidGroupIcon className="h-4 w-4" />
            )}
          </div>
          <span className="truncate">{displayName}</span>
        </span>
      </button>
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
              menu.open ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-has-[:focus-visible]:opacity-100',
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
              <MenuHeader title={displayName}
                subtitle={library.type === 'shared' ? _(`library.visibility${library.visibility === 'public' ? 'Public' : library.visibility === 'password' ? 'Password' : 'Private'}`) : _('library.personalLibraryLabel')}
                onClick={() => { menu.close(); onSelect() }} />
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
          : 'text-stone-600 hover:bg-stone-200/50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/50 dark:hover:text-stone-100',
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
                  : 'text-stone-800 dark:text-stone-200'
                : 'text-stone-400 dark:text-stone-500',
            )}
          >
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
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
  label,
  count,
  active,
  onClick,
  onPointerEnter,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
  onPointerEnter?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: SHELF_NONE_DROPPABLE })
  const { active: dragActive } = useDndContext()
  const isBookDragging = isBookDrag(dragActive?.data.current)
  const dropHint = isBookDragging && isOver


  return (
    <div ref={setNodeRef} className="relative">
      <NavItem
        label={label}
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

const libraryMenuItemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'

function BookdockLogo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
    </svg>
  )
}

function SolidBookIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H18a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 19.5v-15ZM8 6a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H8Z" />
    </svg>
  )
}

function SolidGroupIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.5 13c1.38 0 2.5-1.12 2.5-2.5S17.88 8 16.5 8 14 9.12 14 10.5s1.12 2.5 2.5 2.5zm-9 0C8.88 13 10 11.88 10 10.5S8.88 8 7.5 8 5 9.12 5 10.5 6.12 13 7.5 13zm0 2c-2.33 0-7 1.17-7 3.5V20h14v-1.5c0-2.33-4.67-3.5-7-3.5zm9 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V20h6v-1.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  )
}

