import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { restrictToWindowEdges, snapCenterToCursor } from '@dnd-kit/modifiers'
import { arrayMove } from '@dnd-kit/sortable'

import type { BookListItem, BookSortPrefField, CatalogBook, Library, LibraryListItem, RecentlyReadStyle } from '@bookdock/shared'

import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { formatAuthorList, formatBytes } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'

import { ApiError } from '@/api/client'
import { notify } from '@/lib/notifications'
import { getUserErrorNotification } from '@/lib/error-message'
import QueryErrorState from '@/components/ui/QueryErrorState'

import { indexRoute, type LibrarySearch } from '@/routes/index'

import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useInstanceInfo } from '@/features/auth/hooks'
import BookCard from './components/BookCard'
import BookCardShell from './components/BookCardShell'
import BookCover from './components/BookCover'
import BookGrid from './components/BookGrid'
import CatalogCard from './components/CatalogCard'
import CatalogListRow from './components/CatalogListRow'
import CatalogUploadSheet from './components/CatalogUploadSheet'
import LibraryManageDialog from './components/LibraryManageDialog'
import BookDetailDialog from './components/BookDetailDialog'
import PublishBookDialog from './components/PublishBookDialog'
import EmptyFilter from './components/EmptyFilter'
import EmptyLibrary from './components/EmptyLibrary'
import JoinLibraryDialog from './components/JoinLibraryDialog'
import LibraryDiscoveryDialog from './components/LibraryDiscoveryDialog'
import LibraryHeader from './components/LibraryHeader'
import LibraryPagination from './components/LibraryPagination'
import LibrarySidebar from './components/LibrarySidebar'
import LibraryContextBar from './components/LibraryContextBar'
import TaxonomyDirectory from './components/TaxonomyDirectory'
import ListItemWrapper from './components/ListItemWrapper'
import { SelectionCheck } from './components/RowChrome'
import ReadingStatsCard from './components/ReadingStatsCard'
import RecentlyRead from './components/RecentlyRead'
import SelectionBar from './components/SelectionBar'
import TrashInfo from './components/TrashInfo'
import UploadSheet from './components/UploadSheet'
import { applyLibraryOrder, applyShelfOrder, applyTagOrder, isBookDrag, resolveDropShelfId, type BookDragPayload } from './dnd'
import { catalogWorkRow, privateBookRow, rowCover, type BookRow } from './book-row'
import { libraryUrlCorrection, vanishedFilterCorrection } from './library-filters'
import { BOOK_SORT_DEFAULT_DIR, sortSidebarItems } from './sort-modes'
import { sortCategories } from './taxonomy'
import { useBooks, prefetchBooks, prefetchLibraryCatalog, useDeleteBook, useForkBook, useRestoreBook, usePermanentDeleteBook, useEmptyTrash, useRestoreLibraryBook, usePermanentDeleteLibraryBook, useEmptyLibraryTrash, useShelves, useTags, useMoveBooksToShelf, useReorderShelves, useReorderTags, useReorderLibraryCategories, useReorderLibraryTags, useSetWorkCategory, useTrashEnabled, useTrashCapBytes, useLibraryPrefs, useHiddenLibraries, useUpdateLibraryPrefs, useLibraries, useLibraryCatalog, useLibraryCategories, useLibraryTags, useLibraryRelation } from './hooks'


function estimateDynColumns(): number {  if (typeof window === 'undefined') return 4
  const isDesktop = window.innerWidth >= 768
  const estimatedContentWidth = isDesktop
    ? Math.max(320, window.innerWidth - 260 - 48)
    : Math.max(320, window.innerWidth - 32)
  const gap = 20
  const itemWidth = 176
  return Math.min(6, Math.max(2, Math.floor((estimatedContentWidth + gap) / (itemWidth + gap))))
}

let lastKnownDynColumns = typeof window !== 'undefined' ? estimateDynColumns() : 4
const CLEAR_USER_DATA_STORAGE_KEY = 'bookdock:clear_user_data_on_remove'

export default function Library() {
  const _ = useTranslation()
  const search = useSearch({ from: indexRoute.id })
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const viewPref = useUiStore((s) => s.view)
  const libraryPageSize = useUiStore((s) => s.libraryPageSize)
  const pageSize = libraryPageSize || 24
  const user = useAuthStore((s) => s.user)
  const isGuest = !user || user.guest === true || user.role === 'guest'
  // Private-surface upload gate: the instance switch closes it for ordinary
  // members (fail-open while the instance query loads; the server enforces).
  const { data: instanceData } = useInstanceInfo()
  const userUploadAllowed = instanceData?.data.allowUserUpload !== false
    || (user?.role === 'owner' && user.guest !== true)
  const sortByPref = useUiStore((s) => s.sortBy)
  const sortOrderPref = useUiStore((s) => s.sortOrder)
  const revealHidden = useUiStore((s) => s.revealHidden)
  const libraryPrefs = useLibraryPrefs()
  const { isHidden: isLibraryHidden } = useHiddenLibraries()
  // Resolution chain: explicit URL > per-user server default (N-06) > device
  // localStorage > built-in defaults. The localStorage tier is consulted for
  // guests only: it is the sole layer a guest can write, but a signed-in user
  // reading it would inherit whatever the previous session on a shared browser
  // left behind, so a guest's sort choice would become the owner's default. A
  // linked/shared URL still controls its own view.
  const serverBookSort = libraryPrefs?.bookSort
  const defaultSortBy = serverBookSort?.field ?? (isGuest ? sortByPref : undefined)
  const defaultSortOrder = serverBookSort
    ? (serverBookSort.dir ?? BOOK_SORT_DEFAULT_DIR[serverBookSort.field])
    : (isGuest ? sortOrderPref : undefined)
  const view = search.view ?? libraryPrefs?.view ?? (isGuest ? viewPref : 'grid')
  const query = search.q ?? ''
  const currentPage = search.page ?? 1
  // Trash lives in the private library and, owner-only, inside a shared
  // library. A shared ?trash=1 URL for a non-owner falls back to the normal
  // catalog via the `trash` guard below.
  const requestedLibraryId = !isGuest ? (search.libraryId ?? null) : null
  const { data: librariesData } = useLibraries({ enabled: !isGuest })
  const libraries = useMemo(() => librariesData?.data ?? [], [librariesData])
  const privateLibraryName = isGuest
    ? _('library.allBooks')
    : (libraries.find((library) => library.type === 'private')?.name || _('library.myLibrary'))
  const activeLibrary = requestedLibraryId
    ? (libraries.find((library) => library.id === requestedLibraryId && library.type === 'shared') ?? null)
    : null
  // Shared-library trash is owner-only: only the library owner keeps a
  // ?trash=1 state inside a shared library; admins/members/guests fall back
  // to the normal catalog. The row relation is authoritative here because the
  // per-library relation query resolves later.
  const activeLibraryIsOwner = activeLibrary?.relation === 'owner'
  const trash = !isGuest && (search.trash ?? false) && (!activeLibrary || activeLibraryIsOwner)
  const privateTrashEnabled = useTrashEnabled({ enabled: !isGuest })
  const privateTrashCapBytes = useTrashCapBytes({ enabled: !isGuest })
  // Per-library switch (owner sees the value, others get null); private rows
  // never carry it. Defaults mirror the private trash: on / unlimited.
  const libraryTrashEnabled = activeLibrary ? (activeLibrary.trashEnabled ?? true) : privateTrashEnabled
  const trashEnabled = libraryTrashEnabled
  const trashCapBytes = activeLibrary ? (activeLibrary.trashMaxBytes ? Number(activeLibrary.trashMaxBytes) : undefined) : privateTrashCapBytes
  // The trash defaults to newest-deleted first; the library sort preference
  // is a separate concern and must not be overwritten by trash-only sorting
  const sortBy = search.sortBy ?? (trash ? 'deletedAt' : defaultSortBy ?? 'createdAt')
  const sortOrder = search.sortOrder ?? (trash ? 'desc' : defaultSortOrder ?? BOOK_SORT_DEFAULT_DIR[sortBy as BookSortPrefField] ?? 'desc')
  const categoryScope = search.categoryScope ?? (activeLibrary ? 'subtree' : 'direct')
  const shelfId = search.shelf ?? null
  const tagId = search.tag ?? null
  const author = search.author ?? null
  const series = search.series ?? null
  const format = search.format ?? null
  const readStatus = search.status ?? null

  // Shared-library context (4.7): the selection lives in the URL so refresh
  // and bookmarks reproduce it; the server stays authoritative on access.
  // Guests keep the private view until Phase 6 wires anonymous browsing.
  const libraryStale = !!requestedLibraryId && librariesData !== undefined && !activeLibrary
  const [manageTarget, setManageTarget] = useState<LibraryListItem | null>(null)
  const [joinTarget, setJoinTarget] = useState<Library | null>(null)
  const [discoveryOpen, setDiscoveryOpen] = useState(false)

  const prefetchLibrary = useCallback(
    (patch: Partial<LibrarySearch>, targetLibraryId?: string | null) => {
      const nextShelfId = 'shelf' in patch ? (patch.shelf ?? null) : shelfId
      const nextTagId = 'tag' in patch ? (patch.tag ?? null) : tagId
      const nextTrash = 'trash' in patch ? (patch.trash ?? false) : false
      const nextStatus = 'status' in patch ? (patch.status ?? null) : readStatus
      // Mirror navSearch's sort reset so the prefetched key matches the fetch
      const crossing = nextTrash !== trash
      // Crossing back out of trash must land on the same default the resolved
      // `sortBy`/`sortOrder` use, or the prefetched key misses the real fetch.
      const nextSortBy = crossing ? (nextTrash ? 'deletedAt' : (defaultSortBy ?? 'createdAt')) : sortBy
      const nextSortOrder = crossing
        ? (nextTrash ? 'desc' : (defaultSortOrder ?? BOOK_SORT_DEFAULT_DIR.createdAt))
        : sortOrder
      // The hovered row names its own target: inferring from the current
      // context prefetches the wrong list when leaving it (shared -> private
      // would warm the shared catalog instead of the private books).
      const target = targetLibraryId !== undefined ? targetLibraryId : (activeLibrary?.id ?? null)
      const switching = target !== (activeLibrary?.id ?? null)
      // Prefetch the list the reader would actually land on, which is the
      // catalog while a shared library is in context.
      if (target) {
        void prefetchLibraryCatalog(queryClient, target, {
          page: 1,
          pageSize,
          q: switching ? '' : query,
          sortBy: nextSortBy,
          sortOrder: nextSortOrder,
          categoryId: nextShelfId ?? undefined,
          categoryScope: switching ? 'subtree' : patch.categoryScope ?? categoryScope,
          tagId: nextTagId ?? undefined,
          format: switching ? undefined : format ?? undefined,
          author: switching ? undefined : author ?? undefined,
          series: switching ? undefined : series ?? undefined,
          trash: nextTrash || undefined,
        })
        return
      }
      void prefetchBooks(queryClient, {
        page: 1,
        pageSize,
        search: switching ? '' : query,
        sortBy: nextSortBy,
        sortOrder: nextSortOrder,
        shelfId: nextShelfId,
        tagId: nextTagId,
        author: switching ? null : author,
        series: switching ? null : series,
        format: switching ? null : format,
        readStatus: switching ? null : nextStatus,
        trash: nextTrash,
        showHidden: revealHidden,
      })
    },
    [queryClient, query, trash, defaultSortBy, defaultSortOrder, sortBy, sortOrder, shelfId, tagId, format, readStatus, pageSize, activeLibrary, author, series, revealHidden, categoryScope],
  )

  const [uploadOpen, setUploadOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BookListItem | null>(null)
  const [clearUserDataOnRemove, setClearUserDataOnRemove] = useState(() => {
    try {
      return localStorage.getItem(CLEAR_USER_DATA_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<BookListItem | null>(null)
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [libraryPermanentTarget, setLibraryPermanentTarget] = useState<CatalogBook | null>(null)
  const [detailTarget, setDetailTarget] = useState<BookListItem | null>(null)
  const [publishTarget, setPublishTarget] = useState<BookListItem | null>(null)
  const [forkTarget, setForkTarget] = useState<BookListItem | null>(null)
  const [workDetail, setWorkDetail] = useState<CatalogBook | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const lastSelectIndexRef = useRef<number | null>(null)
  const selectionActive = selectionMode || selection.size > 0
  const deleteBook = useDeleteBook()
  const forkBook = useForkBook()
  const restoreBook = useRestoreBook()
  const permanentDeleteBook = usePermanentDeleteBook()
  const emptyTrash = useEmptyTrash()
  const restoreLibraryBook = useRestoreLibraryBook()
  const permanentDeleteLibraryBook = usePermanentDeleteLibraryBook()
  const emptyLibraryTrash = useEmptyLibraryTrash()
  const sharedTrash = Boolean(activeLibrary && trash)

  function toggleSelect(id: string, index?: number, shiftKey?: boolean) {
    if (activeLibrary && !isLibraryManager) return
    const anchor = lastSelectIndexRef.current
    if (shiftKey && index !== undefined && anchor !== null && anchor !== index) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
      // Range-select walks the rows on screen, never the other library's
      // query, or a shared Shift-click would collect private ids.
      const rangeIds = selectableIds.slice(from, to + 1)
      const selecting = !selection.has(id)
      setSelection((prev) => {
        const next = new Set(prev)
        for (const rangeId of rangeIds) {
          if (selecting) next.add(rangeId)
          else next.delete(rangeId)
        }
        return next
      })
    } else {
      setSelection((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }
    if (index !== undefined) lastSelectIndexRef.current = index
  }

  function clearSelection() {
    setSelection(new Set())
    lastSelectIndexRef.current = null
  }

  function completeBatchAction() {
    setSelectionMode(false)
    clearSelection()
  }

  function deselect(id: string) {
    setSelection((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function toggleSelectionMode() {
    if (selectionActive) {
      setSelectionMode(false)
      clearSelection()
    } else {
      setSelectionMode(true)
    }
  }

  // Reading progress no longer bumps books.updatedAt and global staleTime is
  // Infinity, so the books cache is stale after a reading session. Refetch on mount.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['books'] })
  }, [queryClient])

  // Warm up settings route during browser idle time so clicking settings opens with 0ms lag
  useEffect(() => {
    const handle = typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback(() => { void import('@/features/settings/Settings') })
      : setTimeout(() => { void import('@/features/settings/Settings') }, 1500)
    return () => {
      if (typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(handle as number)
      else clearTimeout(handle)
    }
  }, [])

  // Book drag-to-shelf: the in-flight drag payload drives the overlay and the
  // sidebar drop hints; dragJustEndedRef swallows the click that fires after a
  // completed drag so the dragged card does not navigate into the reader.
  const [dragBookIds, setDragBookIds] = useState<string[] | null>(null)
  const dragJustEndedRef = useRef(false)
  const moveBooksToShelf = useMoveBooksToShelf()
  const setWorkCategory = useSetWorkCategory()
  const reorderShelves = useReorderShelves()
  const reorderTags = useReorderTags()
  const reorderLibraryCategories = useReorderLibraryCategories()
  const reorderLibraryTags = useReorderLibraryTags()
  // Drag-to-manual: a row drop materializes the visual order into sortOrder
  // and switches the default mode to 'manual' in the same gesture.
  const updateLibraryPrefs = useUpdateLibraryPrefs()
  // Which drag is in flight: drives the manual autoscroll (page for book
  // drags, sidebar nav for shelf/tag drags) and the overlay shape.
  const [dragKind, setDragKind] = useState<'book' | 'shelf' | 'tag' | 'library' | null>(null)
  // The shelf row that was just released: its transform reset gets a short
  // transition so it glides from the release position into its slot instead
  // of snapping (a snapped reset reads as a flicker).
  const [settleShelfId, setSettleShelfId] = useState<string | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [settleTagId, setSettleTagId] = useState<string | null>(null)
  const tagSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    if (tagSettleTimerRef.current) clearTimeout(tagSettleTimerRef.current)
  }, [])
  const sidebarNavRef = useRef<HTMLDivElement | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragStart(event: DragStartEvent) {
    if (isGuest) return
    const payload = event.active.data.current as unknown
    if (isBookDrag(payload)) {
      setDragBookIds(payload.bookIds)
      setDragKind('book')
    } else {
      const dragType = (payload as { type?: unknown } | null)?.type
      setDragKind(dragType === 'tag' ? 'tag' : dragType === 'library' ? 'library' : 'shelf')
    }
  }

  function endDrag() {
    setDragBookIds(null)
    setDragKind(null)
    dragJustEndedRef.current = true
    setTimeout(() => {
      dragJustEndedRef.current = false
    }, 0)
  }

  function handleDragEnd(event: DragEndEvent) {
    if (isGuest) return
    endDrag()
    const { active, over } = event
    if (!over || active.id === over.id) return
    const payload = active.data.current as unknown
    if (isBookDrag(payload)) {
      // The same drop in either library: onto a category row, or onto the
      // uncategorized entry to take the row out of its category. Tag rows are
      // not drop targets in either library.
      const targetCategoryId = resolveDropShelfId(String(over.id))
      if (activeLibrary) {
        const moved = payload.bookIds.filter((id) => {
          const work = catalogWorks.find((w) => w.id === id)
          return work ? work.categoryId !== targetCategoryId : false
        })
        if (moved.length === 0) return
        for (const workId of moved) {
          setWorkCategory.mutate({ libraryId: activeLibrary.id, libraryBookId: workId, categoryId: targetCategoryId })
        }
        return
      }
      // No-op when every dragged book already sits in the target shelf.
      const moved = payload.bookIds.filter((id) => {
        const book = allBooks.find((b) => b.id === id)
        return book ? book.shelfId !== targetCategoryId : false
      })
      if (moved.length === 0) return
      moveBooksToShelf.mutate({ bookIds: moved, shelfId: targetCategoryId })
      return
    }
    const dragType = (payload as { type?: unknown } | null)?.type
    if (dragType === 'library') {
      // The reader's own sidebar order. There is no endpoint for it — it lives
      // in the per-user settings blob, whose optimistic merge reorders the
      // sidebar in the same frame, so no settle/override state is needed here.
      // The starting sequence has to be what the sidebar is showing, not the
      // server's join order: reordering from the raw list would drop whatever
      // the reader had already arranged.
      const ordered = applyLibraryOrder(
        libraries.filter((library) => library.type === 'shared'
          && (library.relation === 'owner' || library.relation === 'admin' || library.relation === 'member')
          && !isLibraryHidden(library.id)),
        libraryPrefs?.libraryOrder,
      ).map((library) => library.id)
      const oldIndex = ordered.indexOf(String(active.id))
      const newIndex = ordered.indexOf(String(over.id))
      if (oldIndex < 0 || newIndex < 0) return
      updateLibraryPrefs.mutate({ libraryOrder: arrayMove(ordered, oldIndex, newIndex) })
      return
    }
    if (dragType === 'tag') {
      const ordered = tags.map((tag) => tag.id)
      const oldIndex = ordered.indexOf(String(active.id))
      const newIndex = ordered.indexOf(String(over.id))
      if (oldIndex < 0 || newIndex < 0) return
      const next = arrayMove(ordered, oldIndex, newIndex)
      setTagOrderOverride(next)
      setSettleTagId(String(active.id))
      if (tagSettleTimerRef.current) clearTimeout(tagSettleTimerRef.current)
      tagSettleTimerRef.current = setTimeout(() => {
        tagSettleTimerRef.current = null
        setSettleTagId(null)
      }, 160)
      // The same drag reorders whichever taxonomy is on screen; only the
      // endpoint differs, because the rows live in different scopes.
      if (activeLibrary) reorderLibraryTags.mutate({ libraryId: activeLibrary.id, tagIds: next })
      else reorderTags.mutate(next)
      updateLibraryPrefs.mutate({ tagSort: { mode: 'manual' } })
      return
    }
    if (dragType !== 'shelf') return
    // Shelf drag: active/over are shelf row ids (sortable); over may be the
    // uncategorized droppable or empty space, both of which reorder to no-op.
    const draggedCategory = libraryCategoriesQuery.data?.data.find((category) => category.id === active.id)
    const targetCategory = libraryCategoriesQuery.data?.data.find((category) => category.id === over.id)
    if (activeLibrary && (!draggedCategory || !targetCategory || draggedCategory.parentId !== targetCategory.parentId)) return
    const siblings = activeLibrary ? shelves.filter((shelf) => 'parentId' in shelf && shelf.parentId === draggedCategory?.parentId) : shelves
    const ordered = siblings.map((s) => s.id)
    const oldIndex = ordered.indexOf(String(active.id))
    const newIndex = ordered.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const moved = arrayMove(ordered, oldIndex, newIndex)
    let index = 0
    const next = activeLibrary ? shelves.map((shelf) => ordered.includes(shelf.id) ? moved[index++]! : shelf.id) : moved
    setShelfOrderOverride(next)
    setSettleShelfId(String(active.id))
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null
      setSettleShelfId(null)
    }, 160)
    if (activeLibrary) reorderLibraryCategories.mutate({ libraryId: activeLibrary.id, categoryIds: next })
    else reorderShelves.mutate(next)
    updateLibraryPrefs.mutate({ shelfSort: { mode: 'manual' } })
  }

  function handleDragCancel() {
    endDrag()
  }

  // dnd-kit autoscroll is disabled: it scrolls the document too, which looks
  // broken when dragging a sidebar row near the bottom. Manual autoscroll
  // instead — the page for book drags, the sidebar nav for shelf/tag drags.
  useEffect(() => {
    if (dragKind === null) return
    let lastScroll = 0
    const onPointerMove = (e: PointerEvent) => {
      const now = Date.now()
      if (now - lastScroll < 50) return
      lastScroll = now
      if (dragKind === 'book') {
        const vh = window.innerHeight
        if (e.clientY < vh * 0.15) window.scrollBy({ top: -12 })
        else if (e.clientY > vh * 0.85) window.scrollBy({ top: 12 })
      } else {
        const nav = sidebarNavRef.current
        if (!nav) return
        const rect = nav.getBoundingClientRect()
        if (e.clientY < rect.top + 48) nav.scrollBy({ top: -12 })
        else if (e.clientY > rect.bottom - 48) nav.scrollBy({ top: 12 })
      }
    }
    window.addEventListener('pointermove', onPointerMove)
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [dragKind])

  const { data, isLoading, isError, isFetching, refetch } = useBooks({
    page: currentPage,
    pageSize,
    search: query,
    sortBy,
    sortOrder,
    shelfId,
    tagId,
    author,
    series,
    format,
    readStatus,
    trash,
    showHidden: revealHidden,
    // Server rejects trash queries while the feature is off; the redirect
    // effect below swaps the URL out before the next render settles.
  }, { enabled: (!trash || trashEnabled) && !activeLibrary })

  // 0.4.0: a shared library is not a second page. It is the same list, same
  // search, same sort, same paging and same category/tag filters - read from
  // the catalog endpoint instead of /books. Both hooks are always mounted so
  // the rules of hooks hold; whichever does not match the library in context is
  // disabled and contributes nothing.
  const catalogQuery = useLibraryCatalog(activeLibrary?.id ?? null, {
    page: currentPage,
    pageSize,
    q: query,
    sortBy,
    sortOrder,
    categoryId: shelfId ?? undefined,
    categoryScope,
    tagId: tagId ?? undefined,
    format: format ?? undefined,
    author: author ?? undefined,
    series: series ?? undefined,
    trash: activeLibrary ? trash : undefined,
  })
  const libraryRelationQuery = useLibraryRelation(activeLibrary?.id ?? null)

  const allBooks = useMemo(() => data?.data ?? [], [data])
  const catalogWorks = useMemo(() => catalogQuery.data?.data.items ?? [], [catalogQuery.data])
  const rows = activeLibrary ? catalogWorks : allBooks
  // Selection, range-select, select-all and the drag preview always operate
  // on the rows on screen: catalog works in a shared library, private books
  // otherwise. One list for all four keeps shared actions from reaching into
  // the other library's (usually disabled) query.
  const selectableIds = useMemo(() => rows.map((row) => row.id), [rows])
  const previewRows: BookRow[] = useMemo(
    () => rows.map((row) => ('versions' in row ? catalogWorkRow(row) : privateBookRow(row))),
    [rows],
  )
  const isEmpty = !isLoading && rows.length === 0

  const filterKey = `${activeLibrary?.id ?? ''}:${shelfId ?? ''}:${categoryScope}:${tagId ?? ''}:${query}:${format ?? ''}:${readStatus ?? ''}:${trash}:${author ?? ''}:${series ?? ''}:${sortBy}:${sortOrder}:${pageSize}`
  const lastFilterKeyRef = useRef(filterKey)
  const lastTotalRef = useRef(0)
  const lastTotalSizeRef = useRef(0)

  if (lastFilterKeyRef.current !== filterKey) {
    lastFilterKeyRef.current = filterKey
    lastTotalRef.current = 0
    lastTotalSizeRef.current = 0
  }

  // Total comes from whichever list is in context; the private one also reports
  // bytes, which is what the trash needs and a catalog has none of.
  if (activeLibrary) {
    if (catalogQuery.data?.data.total !== undefined) lastTotalRef.current = catalogQuery.data.data.total
  } else if (data?.total !== undefined) {
    lastTotalRef.current = data.total
    lastTotalSizeRef.current = data.totalSize ?? 0
  }

  const total = lastTotalRef.current
  const totalSize = lastTotalSizeRef.current
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const listLoading = activeLibrary ? catalogQuery.isLoading : isLoading
  const listError = activeLibrary ? catalogQuery.isError : isError
  const listFetching = activeLibrary ? catalogQuery.isFetching : isFetching
  const listRefetch = activeLibrary ? catalogQuery.refetch : refetch
  // The library is gone but the URL (or a stale list cache) still names it:
  // leaving/deleting resolves in the list a beat after the catalog 403s, and
  // a resurrected ?libraryId= (back button, bookmark) never resolves at all.
  // Either way the list endpoint answers LIBRARY_NOT_FOUND, which is the
  // stale-library case, not a retryable list failure.
  const catalogGone = activeLibrary !== null
    && catalogQuery.error instanceof ApiError
    && catalogQuery.error.code === 'LIBRARY_NOT_FOUND'

  const libraryRelation = libraryRelationQuery.data?.data.relation
  const isLibraryManager = libraryRelation === 'owner' || libraryRelation === 'admin'
  const hasPublishTarget = !isGuest && !activeLibrary && libraries.some((library) => (
    library.type === 'shared' && (library.relation === 'owner' || library.relation === 'admin')
  ))
  const canPublishBook = (book: BookListItem) => hasPublishTarget && (book.kind === undefined || book.kind === 'personal')
  const canPublishDetail = detailTarget ? canPublishBook(detailTarget) : false
  // The manage dialog can target a library that is not in context, so its
  // relation comes from the listed row rather than the active-library query;
  // the row's own relation is the fallback before the list loads.
  const manageRelation = manageTarget
    ? (libraries.find((l) => l.id === manageTarget.id)?.relation ?? manageTarget.relation)
    : null
  // One upload surface per context. A reader may always upload to their own
  // library; a shared library accepts files from curators, plus members when
  // the owner opened member uploads — and the drop-anywhere shortcut has to
  // obey the same rule or a file would be dragged in and silently refused.
  // The instance upload switch only closes the private surface for ordinary
  // members — managers keep curating their libraries, and the server enforces
  // all of this regardless.
  const canContribute = activeLibrary?.type === 'shared'
    && libraryRelation === 'member'
    && activeLibrary.allowMemberUpload === true
  const canUpload = !isGuest && (activeLibrary ? (isLibraryManager || canContribute) : userUploadAllowed)
  const setUploadOpenIfAllowed = useCallback((open: boolean) => {
    if (canUpload) setUploadOpen(open)
  }, [canUpload])

  const shelvesQuery = useShelves()
  const tagsQuery = useTags()
  const libraryCategoriesQuery = useLibraryCategories(activeLibrary?.id ?? null)
  const libraryTagsQuery = useLibraryTags(activeLibrary?.id ?? null)
  const shelvesData = shelvesQuery.data
  const tagsData = tagsQuery.data
  // Local mirror of the shelf order: dnd-kit clears its drag state in the same
  // event as our onDragEnd, but the react-query cache update lands a render
  // later — without this the rows would flash back to the old order for a
  // frame. The override is applied synchronously on drag end and dropped once
  // the query catches up.
  const [shelfOrderOverride, setShelfOrderOverride] = useState<string[] | null>(null)
  const [tagOrderOverride, setTagOrderOverride] = useState<string[] | null>(null)
  // Must mirror LibrarySidebar's memo: handleDragEnd materializes this exact
  // visual order when a category/tag row is dropped, in either library.
  const shelves = useMemo(
    () => activeLibrary
      ? sortCategories(applyShelfOrder(libraryCategoriesQuery.data?.data ?? [], shelfOrderOverride), libraryPrefs?.shelfSort)
      : sortSidebarItems(applyShelfOrder(shelvesData?.data ?? [], shelfOrderOverride), libraryPrefs?.shelfSort),
    [activeLibrary, libraryCategoriesQuery.data, shelvesData, shelfOrderOverride, libraryPrefs?.shelfSort],
  )
  const tags = useMemo(
    () => sortSidebarItems(applyTagOrder(activeLibrary ? (libraryTagsQuery.data?.data ?? []) : (tagsData?.data ?? []), tagOrderOverride), libraryPrefs?.tagSort),
    [activeLibrary, libraryTagsQuery.data, tagsData, tagOrderOverride, libraryPrefs?.tagSort],
  )
  useEffect(() => {
    setShelfOrderOverride(null)
  }, [activeLibrary, shelvesData, libraryCategoriesQuery.data])
  useEffect(() => {
    setTagOrderOverride(null)
  }, [activeLibrary, tagsData, libraryTagsQuery.data])
  // The active category's name must resolve against the library in context: a
  // category id from one library means nothing in the other.
  const activeShelfName = shelfId
    ? (activeLibrary
      ? libraryCategoriesQuery.data?.data.find((c) => c.id === shelfId)?.name
      : shelvesData?.data.find((s) => s.id === shelfId)?.name)
    : undefined
  const activeTagName = tagId
    ? (activeLibrary
      ? libraryTagsQuery.data?.data.find((tag) => tag.id === tagId)?.name
      : tagsData?.data.find((tag) => tag.id === tagId)?.name)
    : undefined
  const metadataFilter = author
    ? { kind: 'author' as const, value: author }
    : series
      ? { kind: 'series' as const, value: series }
      : null
  const viewTitle = trash
    ? _('library.trash')
    : shelfId === 'none'
      ? _('library.uncategorized')
      : metadataFilter?.kind === 'author'
        ? _('library.authorFilterTitle', { name: metadataFilter.value })
          : metadataFilter?.kind === 'series'
            ? _('library.seriesFilterTitle', { name: metadataFilter.value })
            : (activeShelfName ?? activeTagName ?? activeLibrary?.name ?? privateLibraryName)

  const hasActiveFilter = Boolean(
    query || author || series || format || readStatus,
  )

  const readStatusName = readStatus === 'wishlist'    ? _('library.readStatusWishlist')
    : readStatus === 'reading'
      ? _('library.readStatusReading')
      : readStatus === 'idle'
        ? _('library.readStatusIdle')
        : readStatus === 'finished'
          ? _('library.readStatusFinished')
          : readStatus === 'abandoned'
            ? _('library.readStatusAbandoned')
            : undefined
  // A shared library's category is the same row as a private shelf, so the tab
  // says 分类 there and 书架 in the private library - one wording per kind of
  // library, not one per row type.
  const libraryDocumentTitle = trash
    ? _('library.trash')
    : shelfId === 'none'
      ? `${_('app.name')} · ${_('library.uncategorized')}`
      : activeShelfName
        ? _(activeLibrary ? 'library.categoryDocumentTitle' : 'library.shelfDocumentTitle', { name: activeShelfName })
        : activeTagName
          ? _('library.tagDocumentTitle', { name: activeTagName })
          : activeLibrary
            ? `${_('app.name')} · ${activeLibrary.name}`
            : readStatusName
              ? `${_('app.name')} · ${readStatusName}`
              : format
                ? `${_('app.name')} · ${format.toUpperCase()}`
                : metadataFilter?.kind === 'author'
                  ? _('library.authorFilterTitle', { name: metadataFilter.value })
                  : metadataFilter?.kind === 'series'
                    ? _('library.seriesFilterTitle', { name: metadataFilter.value })
                    : query
                      ? _('library.searchDocumentTitle', { query })
                      : _('app.name')
  usePageTitle(libraryDocumentTitle)

  useEffect(() => {
    if (!selectionActive) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectionMode(false)
        clearSelection()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelection((prev) => {
          const allCurrentSelected = selectableIds.length > 0 && selectableIds.every((id) => prev.has(id))
          const next = new Set(prev)
          if (allCurrentSelected) {
            for (const id of selectableIds) next.delete(id)
          } else {
            for (const id of selectableIds) next.add(id)
          }
          return next
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectionActive, selectableIds])

  useGlobalDragToggle(setUploadOpenIfAllowed)

  const navSearch = useCallback(
    (patch: Partial<LibrarySearch>) => {
      // The trash has its own default sort; URL sort params are meaningful only
      // within the list/trash domain they were set in, so drop them on crossing
      const nextTrash = 'trash' in patch ? (patch.trash ?? false) : trash
      const sortPatch = nextTrash !== trash ? { sortBy: undefined, sortOrder: undefined } : null
      const filterChanged = (['shelf', 'tag', 'q', 'format', 'status', 'trash', 'author', 'series', 'categoryScope'] as const)
        .some((key) => key in patch && patch[key] !== search[key])
      return navigate({ to: '/', search: { ...search, ...sortPatch, ...(filterChanged ? { page: undefined } : null), ...patch }, replace: !('directory' in patch) })
    },
    [navigate, search, trash],
  )

  // Switching libraries leaves every filter that belonged to the previous one,
  // in a single navigation: those params are scoped to a library and must never
  // leak across, and two navigations would race on stale URL state.
  const handleSwitchLibrary = useCallback((id: string | null) => {
    void navSearch({
      libraryId: id ?? undefined,
      directory: undefined,
      categoryScope: undefined,
      shelf: undefined,
      tag: undefined,
      page: undefined,
      trash: undefined,
      q: undefined,
      status: undefined,
      format: undefined,
      author: undefined,
      series: undefined,
    })
  }, [navSearch])

  const clearActiveFilters = useCallback(() => {
    void navSearch({
      q: undefined,
      author: undefined,
      series: undefined,
      format: undefined,
      status: undefined,
      page: undefined,
    })
  }, [navSearch])

  // A shared/bookmarked ?trash=1 URL must not dead-end when the feature is
  // switched off (e.g. in another tab): bounce back to the plain library.
  useEffect(() => {
    if (trash && !trashEnabled) {
      navSearch({ trash: undefined })
    }
  }, [trash, trashEnabled, navSearch])

  // The server confirmed this library is no longer visible (left, deleted,
  // access revoked): bounce to the first available library instead of
  // stranding the reader on a dead URL. Local-only staleness (libraryStale)
  // stays manual — the list cache can lag right after joining, and bouncing
  // there would evict a library the reader legitimately just entered.
  const catalogGoneRedirectedRef = useRef(false)
  useEffect(() => {
    if (!catalogGone) {
      catalogGoneRedirectedRef.current = false
      return
    }
    if (catalogGoneRedirectedRef.current) return
    catalogGoneRedirectedRef.current = true
    notify.info(_('library.libraryUnavailable'))
    handleSwitchLibrary(null)
  }, [catalogGone, handleSwitchLibrary, _])

  // A shared library's catalog cannot honour the reading-state dimensions, so
  // the URL is corrected rather than quietly ignored (see library-filters for
  // the rule and why the sort is replaced instead of cleared).
  useEffect(() => {
    if (!activeLibrary) return
    const patch = libraryUrlCorrection({ readStatus, sortBy, sortOrder })
    if (Object.keys(patch).length > 0) navSearch(patch)
  }, [activeLibrary, readStatus, sortBy, sortOrder, navSearch])

  useEffect(() => {
    if (total > 0 && currentPage > totalPages) {
      navSearch({ page: totalPages === 1 ? undefined : totalPages })
    }
  }, [total, currentPage, totalPages, navSearch])

  // A shelf or tag can leave the sidebar while the URL still names it - hidden
  // again, unhidden, or deleted - and the server would keep filtering by an id
  // the reader can no longer see or click. That leaves the list at zero with no
  // way out. Wait for the taxonomy to actually load first: an in-flight query
  // reports an empty list and would clear a valid filter.
  const taxonomyLoading = activeLibrary
    ? libraryCategoriesQuery.isLoading || libraryTagsQuery.isLoading
    : shelvesQuery.isLoading || tagsQuery.isLoading
  const taxonomyFailed = activeLibrary
    ? libraryCategoriesQuery.isError || libraryTagsQuery.isError
    : shelvesQuery.isError || tagsQuery.isError
  useEffect(() => {
    if (taxonomyLoading || taxonomyFailed) return
    const patch = vanishedFilterCorrection({
      shelfId,
      tagId,
      shelfIds: shelves.map((shelf) => shelf.id),
      tagIds: tags.map((tag) => tag.id),
    })
    if (Object.keys(patch).length > 0) navSearch(patch)
  }, [taxonomyLoading, taxonomyFailed, shelfId, tagId, shelves, tags, navSearch])

  // Uncategorized is a virtual view: staying on it after the last book is
  // moved/deleted away is a dead end, so leave back to all books. A view
  // entered already empty keeps its empty state — bookmarked ?shelf=none
  // URLs must not be bounced.
  const uncategorizedEmptyOnEntryRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (shelfId !== 'none') {
      uncategorizedEmptyOnEntryRef.current = null
      return
    }
    // The placeholder total belongs to the previous view, not this one
    if (listLoading) return
    if (uncategorizedEmptyOnEntryRef.current === null) {
      uncategorizedEmptyOnEntryRef.current = total === 0
    } else if (!uncategorizedEmptyOnEntryRef.current && total === 0) {
      uncategorizedEmptyOnEntryRef.current = null
      navSearch({ shelf: undefined })
    }
  }, [shelfId, listLoading, total, navSearch])

  const gridColumns = useUiStore((s) => s.gridColumns)
  const recentlyReadStyle = libraryPrefs?.recentlyReadStyle ?? 'off'
  const readingStatsEnabled = libraryPrefs?.readingStatsEnabled !== false
  const gridCardFields = libraryPrefs?.gridCardFields

  const containerRef = useRef<HTMLDivElement>(null)
  const [dynColumns, setDynColumns] = useState(lastKnownDynColumns)

  useLayoutEffect(() => {
    if (gridColumns !== 'auto') return
    const el = containerRef.current
    if (!el) return
    const update = (width: number) => {
      if (width <= 0) return
      const gap = 20
      const itemWidth = 176
      const next = Math.min(6, Math.max(2, Math.floor((width + gap) / (itemWidth + gap))))
      lastKnownDynColumns = next
      setDynColumns((prev) => (prev !== next ? next : prev))
    }
    const initialWidth = el.getBoundingClientRect().width || el.clientWidth
    if (initialWidth > 0) update(initialWidth)

    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [gridColumns])

  const columns = gridColumns === 'auto' ? dynColumns : Number(gridColumns)

  // Selection spans filters within one library: switching shelf/category/tag/
  // search/sort keeps every selected id so books scattered across shelves can
  // be organized in one batch. Only a library or trash switch clears, because
  // private version ids and shared work ids are not interchangeable and trash
  // offers a different action set. Filter/sort/page changes only reset the
  // Shift-click anchor, which is an index into the visible rows.
  useEffect(() => {
    clearSelection()
    setSelectionMode(false)
  }, [activeLibrary?.id, trash])

  useEffect(() => {
    lastSelectIndexRef.current = null
  }, [currentPage, activeLibrary?.id, shelfId, categoryScope, tagId, query, format, readStatus, trash, author, series, sortBy, sortOrder])

  function goToPage(targetPage: number) {
    if (targetPage < 1 || targetPage > totalPages || targetPage === currentPage) return
    void navSearch({ page: targetPage === 1 ? undefined : targetPage }).then(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }



  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} autoScroll={false} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div className="flex min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
        {/* The sidebar is always there (0.4.0): switching library is a sidebar
            row, so it changes what the rows below it mean rather than replacing
            the page the way the old standalone library view did. */}
        <LibrarySidebar
          key={`${user?.id ?? 'guest'}:${activeLibrary?.id ?? 'private'}`}
          sessionKey={`${user?.id ?? 'guest'}:${activeLibrary?.id ?? 'private'}`}
          navSearch={navSearch}
          onPrefetchNavigation={prefetchLibrary}
          shelfId={shelfId}
          tagId={tagId}
          trash={trash}
          readOnly={isGuest}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
          navRef={sidebarNavRef}
          shelfOrderOverride={shelfOrderOverride}
          settleShelfId={settleShelfId}
          tagOrderOverride={tagOrderOverride}
          settleTagId={settleTagId}
          libraries={libraries}
          activeLibraryId={activeLibrary?.id ?? null}
          onSelectLibrary={handleSwitchLibrary}
          onManageLibrary={setManageTarget}
          onJoinLibrary={setJoinTarget}
          onExploreLibraries={() => setDiscoveryOpen(true)}
          directory={search.directory}
        />

      <main className="flex min-w-0 flex-1 flex-col px-3 py-5 sm:px-4 sm:py-8 md:px-8">
        {search.directory && !libraryStale && !catalogGone ? <TaxonomyDirectory key={`${user?.id ?? 'guest'}:${activeLibrary?.id ?? 'private'}:${search.directory}`}
          libraryId={activeLibrary?.id ?? null} sessionKey={`${user?.id ?? 'guest'}:${activeLibrary?.id ?? 'private'}`} panel={search.directory}
          canManage={!isGuest && (!activeLibrary || isLibraryManager)} navSearch={navSearch} onOpenNavigation={() => setMobileNavOpen(true)} /> : <>
        <LibraryHeader
          navSearch={navSearch}
          view={view}
          query={query}
          sortBy={sortBy}
          sortOrder={sortOrder}
          format={format}
          readStatus={readStatus}
          trash={trash}
          catalogMode={activeLibrary !== null}
          categoryScope={search.categoryScope}
          canSwitchCategoryScope={Boolean(activeLibrary && shelfId
            && libraryCategoriesQuery.data?.data.some((category) => category.id === shelfId && !category.parentId)
            && libraryCategoriesQuery.data?.data.some((category) => category.parentId === shelfId))}
          onUploadClick={canUpload ? () => setUploadOpen(true) : undefined}
          trashCount={total}
          bookSize={trash && !activeLibrary ? totalSize : undefined}
          trashCapBytes={trash ? trashCapBytes : undefined}
          onEmptyTrash={isGuest ? undefined : () => setEmptyTrashOpen(true)}
          selectionActive={selectionActive}
          onToggleSelectMode={isGuest || (activeLibrary && !isLibraryManager) ? undefined : toggleSelectionMode}
          onOpenNavigation={() => setMobileNavOpen(true)}
          title={viewTitle}
          bookCount={total}
          onResetMetadataFilter={metadataFilter ? () => navSearch({ author: undefined, series: undefined }) : undefined}
        />

        {!trash && <LibraryContextBar search={search} navSearch={navSearch} onClear={clearActiveFilters} />}

        {(shelvesQuery.isError || tagsQuery.isError) && !catalogGone && (
          <QueryErrorState
            className="py-4"
            isRetrying={shelvesQuery.isFetching || tagsQuery.isFetching}
            onRetry={() => Promise.all([shelvesQuery.refetch(), tagsQuery.refetch()])}
          />
        )}

        {!isGuest && !activeLibrary && readingStatsEnabled && !trash && !query && !metadataFilter && !selectionActive && <ReadingStatsCard />}
        {!isGuest && !activeLibrary && recentlyReadStyle !== 'off' && !trash && !query && !metadataFilter && !selectionActive && <RecentlyRead style={recentlyReadStyle as Exclude<RecentlyReadStyle, 'off'>} />}

        <div
          ref={containerRef}
          className={`min-h-0 flex-1 ${totalPages > 1 ? (selectionActive ? 'pb-32 sm:pb-36' : 'pb-20 sm:pb-24') : (selectionActive ? 'pb-20' : 'pb-6')}`}
        >
          {listLoading ? (
            <InitialLoading view={view} columns={columns} />
          ) : listError && rows.length === 0 && !catalogGone ? (
            <QueryErrorState isRetrying={listFetching} onRetry={() => void listRefetch()} />
          ) : libraryStale || catalogGone ? (
            /* A ?libraryId= for a library this reader can no longer see is
               reported where any other list problem is reported - inside the
               list, with the header, sidebar and paging still around it - rather
               than by replacing the page. The one thing worth saying out loud is
               why the list is empty, and how to get somewhere else. catalogGone
               is the same case arriving through the catalog instead of the
               list: the URL (or a not-yet-refreshed list cache) still names a
               library the server already refuses. */
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-stone-500 dark:text-stone-400">{_('library.libraryUnavailable')}</p>
              <button
                type="button"
                onClick={() => handleSwitchLibrary(null)}
                className="rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
              >
                {_('library.backToPrivate')}
              </button>
            </div>
          ) : isEmpty ? (
            trash
              ? <EmptyTrash />
              : hasActiveFilter
                ? <EmptyFilter onClear={clearActiveFilters} />
                : <EmptyLibrary canUpload={canUpload} isView={Boolean(shelfId || tagId)} />
          ) : activeLibrary ? (
            sharedTrash ? (
              view === 'list' ? (
                <BookGrid pageKey={currentPage} view="list" columns={columns}>
                  {catalogWorks.map((work, index) => (
                    <LibraryTrashWorkRow
                      key={work.id}
                      work={work}
                      autoCleanDays={activeLibrary.trashAutoCleanDays ?? 30}
                      selected={selection.has(work.id)}
                      selectionActive={selectionActive}
                      onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                      onRestore={() => {
                        deselect(work.id)
                        void restoreLibraryBook.mutateAsync({ libraryId: activeLibrary.id, libraryBookId: work.id, title: work.title }).catch(() => undefined)
                      }}
                      onPermanentDelete={() => setLibraryPermanentTarget(work)}
                    />
                  ))}
                </BookGrid>
              ) : (
                <BookGrid pageKey={currentPage} view={view} columns={columns}>
                  {catalogWorks.map((work, index) => (
                    <LibraryTrashWorkCard
                      key={work.id}
                      work={work}
                      autoCleanDays={activeLibrary.trashAutoCleanDays ?? 30}
                      selected={selection.has(work.id)}
                      selectionActive={selectionActive}
                      onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                      onRestore={() => {
                        deselect(work.id)
                        void restoreLibraryBook.mutateAsync({ libraryId: activeLibrary.id, libraryBookId: work.id, title: work.title }).catch(() => undefined)
                      }}
                      onPermanentDelete={() => setLibraryPermanentTarget(work)}
                    />
                  ))}
                </BookGrid>
              )
            ) : view === 'list' ? (
              /* List view draws rows, not cards: the same data, the same
                 selection and the same drag rules, only the row chrome differs
                 the way a private list row differs from a private card. */
              <BookGrid pageKey={currentPage} view="list" columns={columns}>
                {catalogWorks.map((work, index) => (
                  <CatalogListRow
                    key={work.id}
                    work={work}
                    canManage={isLibraryManager}
                    canCollect={libraryRelation !== 'guest'}
                    selected={selection.has(work.id)}
                    selectionActive={selectionActive}
                    selection={selection}
                    dragJustEndedRef={dragJustEndedRef}
                    onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                    onShowDetails={setWorkDetail}
                  />
                ))}
              </BookGrid>
            ) : (
              /* Same container, same card, same view switch and same drag rules as
                 the private list; only the row's data differs, because a catalog
                 row is a work with its versions rather than one book. */
              <BookGrid pageKey={currentPage} view={view} columns={columns}>
                {catalogWorks.map((work, index) => (
                  <DraggableWorkCard
                    key={work.id}
                    work={work}
                    canManage={isLibraryManager}
                    canCollect={libraryRelation !== 'guest'}
                    gridCardFields={gridCardFields}
                    selected={selection.has(work.id)}
                    selectionActive={selectionActive}
                    selection={selection}
                    dragJustEndedRef={dragJustEndedRef}
                    onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                    onShowDetails={setWorkDetail}
                  />
                ))}
              </BookGrid>
            )
          ) : view === 'grid' ? (
            <BookGrid pageKey={currentPage} view="grid" columns={columns}>
              {allBooks.map((book, index) => {
                if (trash) {
                  return (
                    <div
                      key={book.id}
                      className="rounded-xl"
                    >
                      <BookCard
                        book={book}
                        selected={selection.has(book.id)}
                        selectionActive={selectionActive}
                        gridCardFields={['title', 'author']}
                        onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                        onRestore={(b) => {
                          deselect(b.id)
                          void restoreBook.mutateAsync({ id: b.id, title: b.title }).catch(() => undefined)
                        }}
                        onPermanentDelete={setPermanentDeleteTarget}
                      />
                    </div>
                  )
                }
                return (
                  <DraggableBookCard key={book.id} book={book} selection={selection} selectionActive={selectionActive} disabled={isGuest}>
                    <Link
                      to="/books/$id"
                      params={{ id: book.id }}
                      onClick={(e) => {
                        // dnd-kit does not suppress the click after a drag;
                        // the flag is set by handleDragEnd and cleared on the
                        // next macrotask, so this runs only for genuine clicks.
                        if (dragJustEndedRef.current) {
                          e.preventDefault()
                          return
                        }
                        if (selectionActive) {
                          e.preventDefault()
                          toggleSelect(book.id, index, e.shiftKey)
                          return
                        }
                        if (e.ctrlKey || e.metaKey || e.shiftKey) {
                          e.preventDefault()
                          toggleSelect(book.id, index, e.shiftKey)
                        }
                      }}
                      className="block rounded-xl"
                    >
                      <BookCard
                        book={book}
                        selected={selection.has(book.id)}
                        selectionActive={selectionActive}
                        gridCardFields={gridCardFields}
                        onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                        readOnly={isGuest}
                        onDelete={isGuest ? undefined : setDeleteTarget}
                        onPublish={canPublishBook(book) ? setPublishTarget : undefined}
                        onFork={isGuest ? undefined : setForkTarget}
                        onShowDetails={setDetailTarget}
                      />
                    </Link>
                  </DraggableBookCard>
                )
              })}
            </BookGrid>
          ) : (
            <BookGrid pageKey={currentPage} view="list" columns={columns}>
              {allBooks.map((book, index) => {
                if (trash) {
                  return (
                    <TrashListRow
                      key={book.id}
                      book={book}
                      selected={selection.has(book.id)}
                      selectionActive={selectionActive}
                      onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                      onRestore={(b) => {
                        deselect(b.id)
                        void restoreBook.mutateAsync({ id: b.id, title: b.title }).catch(() => undefined)
                      }}
                      onPermanentDelete={setPermanentDeleteTarget}
                    />
                  )
                }
                return (
                  <ListItemWrapper
                    key={book.id}
                    book={book}
                    selection={selection}
                    selectionActive={selectionActive}
                    dragJustEndedRef={dragJustEndedRef}
                    onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                    readOnly={isGuest}
                    onDelete={isGuest ? undefined : setDeleteTarget}
                    onPublish={canPublishBook(book) ? setPublishTarget : undefined}
                    onFork={isGuest ? undefined : setForkTarget}
                    onShowDetails={setDetailTarget}
                  />
                )
              })}
            </BookGrid>
          )}
        </div>

        {!listError && (totalPages > 1 ? total > 0 : !listLoading) && (
          <LibraryPagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalBooks={total}
            onPageChange={goToPage}
            selectionActive={selectionActive}
          />
        )}
      </>}
      </main>

      {/* Shared selections contain work ids; private selections contain version ids.
          The shared trash is owner-only (see the trash guard above), so its
          batch bar only offers restore/permanent-delete. */}
      {!isGuest && (!activeLibrary || isLibraryManager) && selection.size > 0 && (
        <SelectionBar
          selectedIds={Array.from(selection)}
          onClear={clearSelection}
          onComplete={completeBatchAction}
          onRetainSelection={(ids) => { setSelection(new Set(ids)); lastSelectIndexRef.current = null }}
          trash={trash}
          trashEnabled={trashEnabled}
          elevated={totalPages > 1}
          libraryId={activeLibrary?.id}
        />
      )}

      {/* The dialogs that make a shared library reversible from the UI instead
          of only through the API. Creating moved to the settings library list. */}
      {joinTarget && (
        <JoinLibraryDialog
          open
          libraryId={joinTarget.id}
          needsPassword={joinTarget.visibility === 'password'}
          onClose={() => setJoinTarget(null)}
        />
      )}

      {discoveryOpen && (
        <LibraryDiscoveryDialog
          open
          onClose={() => setDiscoveryOpen(false)}
          onSelectLibrary={(id) => {
            void handleSwitchLibrary(id)
            setDiscoveryOpen(false)
          }}
          onJoinWithPassword={(lib) => {
            setJoinTarget(lib)
          }}
        />
      )}

      {manageTarget && (
        <LibraryManageDialog
          library={manageTarget}
          isOwner={manageRelation === 'owner'}
          onClose={() => setManageTarget(null)}
        />
      )}

      {/* One upload window, pointed at whichever library is in context. */}
      {canUpload && (activeLibrary ? (
        <CatalogUploadSheet
          open={uploadOpen}
          libraryId={activeLibrary.id}
          categoryId={shelfId === 'none' ? null : shelfId}
          onClose={() => setUploadOpen(false)}
        />
      ) : (
        <UploadSheet
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          shelfId={shelfId && shelfId !== 'none' ? shelfId : undefined}
          tagId={tagId ?? undefined}
        />
      ))}

      <BookDetailDialog
        book={detailTarget}
        work={activeLibrary && workDetail ? {
          // Live row from the catalog query, not the click-time snapshot: menu
          // toggles and version uploads invalidate the catalog, and the open
          // dialog must follow without closing and reopening.
          work: catalogWorks.find((w) => w.id === workDetail.id) ?? workDetail,
          library: activeLibrary,
          canManage: isLibraryManager,
          canCollect: libraryRelation !== 'guest',
          canContribute,
        } : null}
        readOnly={isGuest}
        onClose={() => {
          setDetailTarget(null)
          setWorkDetail(null)
        }}
        onPublish={canPublishDetail ? (book) => {
          setDetailTarget(null)
          setPublishTarget(book)
        } : undefined}
        onDelete={(b) => {
          setDetailTarget(null)
          setDeleteTarget(b)
        }}
      />

      {publishTarget && (
        <PublishBookDialog
          book={publishTarget}
          libraries={libraries}
          onClose={() => setPublishTarget(null)}
          onOpenLibrary={(libraryId) => {
            setPublishTarget(null)
            handleSwitchLibrary(libraryId)
          }}
        />
      )}

      {forkTarget && (
        <ConfirmDialog
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="6" r="3" />
              <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
              <path d="M12 12v3" />
            </svg>
          }
          title={_('library.forkLocalTitle')}
          message={_('library.forkLocalConfirm')}
          warning={_('library.forkLocalWarning')}
          confirmLabel={_('library.forkLocalConfirmBtn')}
          confirmVariant="primary"
          confirmDisabled={forkBook.isPending}
          onClose={() => setForkTarget(null)}
          onConfirm={() => {
            const target = forkTarget
            setForkTarget(null)
            forkBook.mutate({ bookId: target.id }, {
              onSuccess: () => notify.success(_('library.forkLocalSuccess')),
              onError: (err) => notify.error(getUserErrorNotification(err, 'library.forkLocalFailed')),
            })
          }}
        />
      )}

      {deleteTarget && (() => {
        const isCollected = Boolean(deleteTarget.source)
        if (isCollected) {
          const title = deleteTarget.title ?? ''
          return (
            <ConfirmDialog
              title={_('library.removeFromLibrary')}
              message={
                <div>
                  <div>
                    {title.startsWith('《')
                      ? _('library.removeConfirmBare', { title })
                      : _('library.removeConfirm', { title })}
                  </div>
                  <label className="mt-3 flex items-start gap-2 cursor-pointer select-none text-xs text-stone-600 dark:text-stone-300">
                    <input
                      type="checkbox"
                      checked={clearUserDataOnRemove}
                      onChange={(e) => {
                        setClearUserDataOnRemove(e.target.checked)
                        try {
                          localStorage.setItem(CLEAR_USER_DATA_STORAGE_KEY, e.target.checked ? 'true' : 'false')
                        } catch {}
                      }}
                      className="mt-0.5 rounded border-stone-300 text-stone-900 focus:ring-stone-500 dark:border-stone-600 dark:bg-stone-800 dark:checked:bg-stone-200 dark:checked:text-stone-900"
                    />
                    <span>{_('library.clearUserDataOnRemove')}</span>
                  </label>
                </div>
              }
              confirmLabel={_('library.removeFromLibrary')}
              confirmVariant="danger"
              onClose={() => setDeleteTarget(null)}
              onConfirm={() => {
                const target = deleteTarget
                setDeleteTarget(null)
                void deleteBook.mutateAsync({
                  id: target.id,
                  title: target.title,
                  isCollected: true,
                  deleteUserData: clearUserDataOnRemove,
                }).catch(() => undefined)
              }}
            />
          )
        }
        return (
        <ConfirmDialog
          title={trashEnabled ? _('library.deleteBook') : _('library.permanentDelete')}
          message={
            trashEnabled ? (
              (deleteTarget.title ?? '').startsWith('《')
                ? _('library.deleteConfirmBare', { title: deleteTarget.title ?? '' })
                : _('library.deleteConfirm', { title: deleteTarget.title ?? '' })
            ) : (
              <>
                {_('library.permanentDeleteConfirm')}
                <span className="mt-1 block truncate text-stone-700 dark:text-stone-200">{deleteTarget.title ?? ''}</span>
              </>
            )
          }
          confirmLabel={trashEnabled ? _('library.delete') : _('library.permanentDelete')}
          confirmVariant="danger"
          warning={
            trashEnabled && trashCapBytes && deleteTarget.size > trashCapBytes
              ? _('library.trashCapImmediate', { size: formatBytes(deleteTarget.size), cap: formatBytes(trashCapBytes) })
              : undefined
          }
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget
            setDeleteTarget(null)
            void deleteBook.mutateAsync({ id: target.id, title: target.title, isCollected: false }).catch(() => undefined)
          }}
        />
        )
      })()}

      {permanentDeleteTarget && (
        <ConfirmDialog
          title={_('library.permanentDelete')}
          message={
            <>
              {_('library.permanentDeleteConfirm')}
              <span className="mt-1 block truncate text-stone-700 dark:text-stone-200">{permanentDeleteTarget.title ?? ''}</span>
            </>
          }
          confirmLabel={_('library.permanentDelete')}
          confirmVariant="danger"
          onClose={() => setPermanentDeleteTarget(null)}
          onConfirm={() => {
            const target = permanentDeleteTarget
            setPermanentDeleteTarget(null)
            deselect(target.id)
            void permanentDeleteBook.mutateAsync({ id: target.id, title: target.title }).catch(() => undefined)
          }}
        />
      )}

      {emptyTrashOpen && (
        <ConfirmDialog
          title={_('library.emptyTrash')}
          message={
            <>
              {_('library.emptyTrashConfirm')}
              {!activeLibrary && totalSize > 0 && (
                <span className="mt-1 block text-stone-700 dark:text-stone-200">
                  {_('library.emptyTrashFrees', { size: formatBytes(totalSize) })}
                </span>
              )}
            </>
          }
          confirmLabel={_('library.emptyTrash')}
          confirmVariant="danger"
          onClose={() => setEmptyTrashOpen(false)}
          onConfirm={() => {
            setEmptyTrashOpen(false)
            if (activeLibrary) {
              void emptyLibraryTrash.mutateAsync({ libraryId: activeLibrary.id }).catch(() => undefined)
            } else {
              void emptyTrash.mutateAsync().catch(() => undefined)
            }
          }}
        />
      )}

      {libraryPermanentTarget && (
        <ConfirmDialog
          title={_('library.permanentDelete')}
          message={
            <>
              {_('library.permanentDeleteConfirm')}
              <span className="mt-1 block truncate text-stone-700 dark:text-stone-200">{libraryPermanentTarget.title}</span>
            </>
          }
          confirmLabel={_('library.permanentDelete')}
          confirmVariant="danger"
          onClose={() => setLibraryPermanentTarget(null)}
          onConfirm={() => {
            const target = libraryPermanentTarget
            setLibraryPermanentTarget(null)
            if (!activeLibrary) return
            deselect(target.id)
            void permanentDeleteLibraryBook.mutateAsync({ libraryId: activeLibrary.id, libraryBookId: target.id, title: target.title }).catch(() => undefined)
          }}
        />
      )}
      </div>

      {/* The DragOverlay mounts only during book drags: dnd-kit auto-detects
          useDragOverlay from its rect, and a mounted (even empty) overlay would
          freeze the dragged shelf row in place instead of letting it follow
          the pointer for the native drag feel. */}
      {dragBookIds !== null && (
        <DragOverlay modifiers={[snapCenterToCursor, restrictToWindowEdges]}>
          <BookDragPreview bookIds={dragBookIds} rows={previewRows} />
        </DragOverlay>
      )}    </DndContext>
  )
}

function BookDragPreview({ bookIds, rows }: { bookIds: string[]; rows: BookRow[] }) {
  const first = rows.find((r) => r.id === bookIds[0])
  if (!first) return null
  const count = bookIds.length
  // The DragOverlay wrapper is sized to the measuring node and centered on the
  // cursor (official snapCenterToCursor); flex-centering the preview inside it
  // puts the cursor exactly at the preview's center. shrink-0 keeps the cover
  // at its own size when the measuring node is small (list-view cover thumb).
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative w-24 shrink-0 overflow-hidden rounded-xl shadow-xl shadow-stone-900/20 ring-1 ring-stone-900/10 dark:ring-white/10">
        <BookCover book={rowCover(first)} coverSrc={first.coverSrc} size="md" />
        {count > 1 && (
          <span className="absolute right-1 top-1 rounded-full bg-stone-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {count}
          </span>
        )}
      </div>
    </div>
  )
}

function DraggableBookCard({
  book,
  selection,
  selectionActive,
  disabled = false,
  children,
}: {
  book: BookListItem
  selection: Set<string>
  selectionActive: boolean
  disabled?: boolean
  children: ReactNode
}) {
  // Dragging a selected card in selection mode carries the whole selection.
  const bookIds = selectionActive && selection.has(book.id) ? Array.from(selection) : [book.id]
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `book:${book.id}`,
    data: { bookIds } satisfies BookDragPayload,
    disabled,
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={isDragging ? 'rounded-xl opacity-60' : 'rounded-xl'}
    >
      {children}
    </div>
  )
}

/**
 * A shared library's row, draggable exactly as far as a private book's is: onto
 * a category row or onto the uncategorized entry. Those are the same rows the
 * private library drops onto (its shelves are this library's categories), and
 * the same three dnd-kit handlers. Tag rows are not drop targets in either
 * library, so a work cannot be dropped on one either.
 */
function DraggableWorkCard({
  work, canManage, canCollect, gridCardFields,
  selected, selectionActive, selection, dragJustEndedRef, onToggleSelect, onShowDetails,
}: {
  work: CatalogBook
  canManage: boolean
  canCollect: boolean
  gridCardFields?: Parameters<typeof BookCard>[0]['gridCardFields']
  selected: boolean
  selectionActive: boolean
  selection: Set<string>
  dragJustEndedRef: React.MutableRefObject<boolean>
  onToggleSelect: (id: string, shiftKey?: boolean) => void
  onShowDetails: (work: CatalogBook) => void
}) {
  // A selected card dragged in selection mode carries the whole selection,
  // the same rule a private card follows; a lone card carries only itself.
  const workIds = selectionActive && selected ? Array.from(selection) : [work.id]
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `book:${work.id}`,
    data: { bookIds: workIds } satisfies BookDragPayload,
    disabled: !canManage,
  })
  // A plain click reads the work's first version, the way a private card
  // reads its book; without a version there is no reader target to link to.
  const firstVersionId = work.versions[0]?.bookVersionId
  const card = (
    <CatalogCard
      book={work}
      canManage={canManage}
      canCollect={canCollect}
      gridCardFields={gridCardFields}
      selected={selected}
      selectionActive={selectionActive}
      onToggleSelect={onToggleSelect}
      onShowDetails={onShowDetails}
    />
  )
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={isDragging ? 'rounded-xl opacity-60' : 'rounded-xl'}
      onClick={(e) => {
        // dnd-kit does not suppress the click after a drag; the flag is set by
        // handleDragEnd and cleared on the next macrotask.
        if (dragJustEndedRef.current) {
          e.preventDefault()
          return
        }
        if (selectionActive || e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault()
          onToggleSelect(work.id, e.shiftKey)
        }
      }}
    >
      {firstVersionId ? (
        <Link
          to="/books/$id"
          params={{ id: firstVersionId }}
          onClick={(e) => {
            if (dragJustEndedRef.current) {
              e.preventDefault()
              return
            }
            if (selectionActive) {
              e.preventDefault()
              onToggleSelect(work.id, e.shiftKey)
              return
            }
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              e.preventDefault()
              onToggleSelect(work.id, e.shiftKey)
              return
            }
            if (work.hidden || work.versions[0]?.status === 'unlisted') {
              // Managers keep reading hidden works like delisted ones; only
              // ordinary readers fall through to the detail dialog.
              if (canManage) return
              e.preventDefault()
              onShowDetails(work)
            }
          }}
          className="block rounded-xl"
        >
          {card}
        </Link>
      ) : (
        card
      )}
    </div>
  )
}

function InitialLoading({ view, columns }: { view: 'grid' | 'list'; columns: number }) {
  if (view === 'list') {
    return (
      <div className="flex flex-col divide-y divide-stone-100 py-2 dark:divide-stone-800">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-3 py-3 px-2">
            <div className="h-14 w-10 shrink-0 rounded bg-stone-200/70 dark:bg-stone-800/70" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 rounded bg-stone-200/70 dark:bg-stone-800/70" />
              <div className="h-3 w-1/4 rounded bg-stone-100 dark:bg-stone-800/40" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  const count = Math.max(columns * 2, 8)
  return (
    <div
      className="grid gap-4 py-2"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl p-1">
          <div className="aspect-[1/1.4] w-full rounded-lg bg-stone-200/70 dark:bg-stone-800/70" />
          <div className="h-3.5 w-3/4 rounded bg-stone-200/70 dark:bg-stone-800/70" />
          <div className="h-3 w-1/2 rounded bg-stone-100 dark:bg-stone-800/40" />
        </div>
      ))}
    </div>
  )
}

function EmptyTrash() {
  const _ = useTranslation()
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="mb-1 flex h-16 w-16 items-center justify-center rounded-2xl border border-stone-200/80 bg-white shadow-xs dark:border-stone-800 dark:bg-stone-900">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400 dark:text-stone-500">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
        </svg>
      </div>
      <p className="font-serif text-lg font-medium text-stone-700 dark:text-stone-200">{_('library.trashEmpty')}</p>
      <p className="text-sm text-stone-400 dark:text-stone-500">{_('library.trashEmptyHint')}</p>
    </div>
  )
}

function TrashListRow({ book, selected, selectionActive, onToggleSelect, onRestore, onPermanentDelete }: {
  book: BookListItem
  selected: boolean
  selectionActive: boolean
  onToggleSelect: (id: string, shiftKey?: boolean) => void
  onRestore: (b: BookListItem) => void
  onPermanentDelete: (b: BookListItem) => void
}) {
  const _ = useTranslation()

  function handleRowClick(e: React.MouseEvent) {
    // Trash rows have no destination: plain clicks only select in selection mode
    if (selectionActive || e.ctrlKey || e.metaKey || e.shiftKey) {
      onToggleSelect(book.id, e.shiftKey)
    }
  }

  return (
    <div
      onClick={handleRowClick}
      className={`group flex items-center gap-3.5 rounded-xl px-3 py-2.5 select-none transition-all hover:bg-white hover:shadow-sm dark:hover:bg-stone-900 ${selectionActive ? 'cursor-pointer' : ''} ${selected ? 'bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700' : ''}`}
    >
      <div className="shrink-0 rounded-xl opacity-80 grayscale-[60%]">
        <BookCover book={book} size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-serif text-sm font-medium text-stone-900 dark:text-stone-100">
          {book.title}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {book.author && (
            <span className="truncate text-xs text-stone-500 dark:text-stone-400">{formatAuthorList(book.authors, book.author)}</span>
          )}
          <TrashInfo book={book} className="shrink-0" />
        </div>
      </div>
      <span className="shrink-0 rounded border border-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:border-stone-700 dark:text-stone-500">
        {book.format}
      </span>
      {selectionActive ? (
        <SelectionCheck selected={selected} />
      ) : (
        <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <button
            type="button"
            aria-label={_('library.restore')}
            title={_('library.restore')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRestore(book)
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-400"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={_('library.permanentDelete')}
            title={_('library.permanentDelete')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onPermanentDelete(book)
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

function LibraryTrashWorkCard({ work, autoCleanDays, selected, selectionActive, onToggleSelect, onRestore, onPermanentDelete }: {
  work: CatalogBook
  autoCleanDays: number
  selected: boolean
  selectionActive: boolean
  onToggleSelect: (id: string, shiftKey?: boolean) => void
  onRestore: () => void
  onPermanentDelete: (work: CatalogBook) => void
}) {
  return (
    <BookCardShell
      row={catalogWorkRow(work)}
      gridCardFields={['title', 'author']}
      selected={selected}
      selectionActive={selectionActive}
      onToggleSelect={onToggleSelect}
      trashCard
      onRestore={onRestore}
      onPermanentDelete={() => onPermanentDelete(work)}
      coverOverlay={(
        <div className="pointer-events-none absolute right-1.5 top-1.5 z-10">
          <TrashInfo book={work} variant="pill" autoCleanDays={autoCleanDays} />
        </div>
      )}
    />
  )
}
/**
 * A trashed shared work in list view, mirroring TrashListRow: small cover,
 * title, author + retention badge, format/version badge, and the same hover
 * restore/permanent-delete icon buttons.
 */
function LibraryTrashWorkRow({ work, autoCleanDays, selected, selectionActive, onToggleSelect, onRestore, onPermanentDelete }: {
  work: CatalogBook
  autoCleanDays: number
  selected: boolean
  selectionActive: boolean
  onToggleSelect: (id: string, shiftKey?: boolean) => void
  onRestore: () => void
  onPermanentDelete: (work: CatalogBook) => void
}) {
  const _ = useTranslation()
  const row = catalogWorkRow(work)
  const versionCount = work.versions.length

  function handleRowClick(e: React.MouseEvent) {
    // Trash rows have no destination: plain clicks only select in selection mode
    if (selectionActive || e.ctrlKey || e.metaKey || e.shiftKey) {
      onToggleSelect(work.id, e.shiftKey)
    }
  }

  return (
    <div
      onClick={handleRowClick}
      className={`group flex items-center gap-3.5 rounded-xl px-3 py-2.5 select-none transition-all hover:bg-white hover:shadow-sm dark:hover:bg-stone-900 ${selectionActive ? 'cursor-pointer' : ''} ${selected ? 'bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700' : ''}`}
    >
      <div className="shrink-0 rounded-xl opacity-80 grayscale-[60%]">
        <BookCover book={rowCover(row)} coverSrc={row.coverSrc} size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-serif text-sm font-medium text-stone-900 dark:text-stone-100">
          {work.title}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {work.author && (
            <span className="truncate text-xs text-stone-500 dark:text-stone-400">{formatAuthorList(work.authors, work.author)}</span>
          )}
          <TrashInfo book={work} className="shrink-0" autoCleanDays={autoCleanDays} />
        </div>
      </div>
      <span className="shrink-0 rounded border border-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:border-stone-700 dark:text-stone-500">
        {versionCount > 1 ? _('library.versionCount', { count: versionCount }) : (work.versions[0]?.format ?? '')}
      </span>
      {selectionActive ? (
        <SelectionCheck selected={selected} />
      ) : (
        <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <button
            type="button"
            aria-label={_('library.restore')}
            title={_('library.restore')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRestore()
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-400"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={_('library.permanentDelete')}
            title={_('library.permanentDelete')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onPermanentDelete(work)
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2V6h14z" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

function useGlobalDragToggle(setOpen: (open: boolean) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // Chrome fires a cleanup dragleave after a completed drop; only a leave
    // while the drag session is still in flight may auto-close the sheet.
    let dragging = false
    const cancelClose = () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        dragging = true
        setOpen(true)
        cancelClose()
      }
    }
    const onDragLeave = () => {
      if (!dragging) return
      cancelClose()
      timer.current = setTimeout(() => setOpen(false), 200)
    }
    const endSession = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
      }
      dragging = false
      cancelClose()
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', endSession)
    window.addEventListener('dragend', endSession)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', endSession)
      window.removeEventListener('dragend', endSession)
      cancelClose()
    }
  }, [setOpen])
}
