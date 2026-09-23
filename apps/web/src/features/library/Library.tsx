import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Virtuoso, VirtuosoGrid, type Components, type GridComponents, type GridItemProps, type GridListProps, type ItemProps } from 'react-virtuoso'

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

import type { BookListItem } from '@bookdock/shared'

import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { formatBytes } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'

import QueryErrorState from '@/components/ui/QueryErrorState'
import SmartMenu from '@/components/ui/SmartMenu'

import { indexRoute, type LibrarySearch } from '@/routes/index'

import ConfirmDialog from '@/components/ui/ConfirmDialog'
import BookCard from './components/BookCard'
import BookCover from './components/BookCover'
import { useContextMenu } from './components/use-context-menu'
import { ContextMenuContent } from './components/BookContextMenu'
import BookDetailDialog from './components/BookDetailDialog'
import EmptyLibrary from './components/EmptyLibrary'
import LibraryHeader from './components/LibraryHeader'
import LibrarySidebar from './components/LibrarySidebar'
import ListItemInfo from './components/ListItemInfo'
import ReadingStatsCard from './components/ReadingStatsCard'
import RecentlyRead from './components/RecentlyRead'
import SelectionBar from './components/SelectionBar'
import TrashInfo from './components/TrashInfo'
import UploadSheet from './components/UploadSheet'
import UnpinButton, { PinIcon } from './components/UnpinButton'
import { applyShelfOrder, applyTagOrder, isBookDrag, resolveDropShelfId, type BookDragPayload } from './dnd'
import { BOOK_SORT_DEFAULT_DIR, sortSidebarItems } from './sort-modes'
import { useInfiniteBooks, prefetchInfiniteBooks, useDeleteBook, useRestoreBook, usePermanentDeleteBook, useEmptyTrash, useShelves, useTags, useMoveBooksToShelf, useReorderShelves, useReorderTags, useTrashEnabled, useTrashCapBytes, useLibraryPrefs, useUpdateLibraryPrefs } from './hooks'

const PAGE_SIZE = 20

export default function Library() {
  const _ = useTranslation()
  const search = useSearch({ from: indexRoute.id })
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const viewPref = useUiStore((s) => s.view)
  const user = useAuthStore((s) => s.user)
  const isGuest = !user || user.guest === true || user.role === 'guest'
  const sortByPref = useUiStore((s) => s.sortBy)
  const sortOrderPref = useUiStore((s) => s.sortOrder)
  const libraryPrefs = useLibraryPrefs()
  // Resolution chain: explicit URL > per-user server default (N-06) > device
  // localStorage (legacy; also the only writable layer for guests). A
  // linked/shared URL still controls its own view.
  const serverBookSort = libraryPrefs?.bookSort
  const defaultSortBy = serverBookSort?.field ?? sortByPref
  const defaultSortOrder = serverBookSort
    ? (serverBookSort.dir ?? BOOK_SORT_DEFAULT_DIR[serverBookSort.field])
    : sortOrderPref
  const view = search.view ?? libraryPrefs?.view ?? viewPref
  const query = search.q ?? ''
  const trash = !isGuest && (search.trash ?? false)
  const trashEnabled = useTrashEnabled({ enabled: !isGuest })
  const trashCapBytes = useTrashCapBytes({ enabled: !isGuest })
  // The trash defaults to newest-deleted first; the library sort preference
  // is a separate concern and must not be overwritten by trash-only sorting
  const sortBy = search.sortBy ?? (trash ? 'deletedAt' : defaultSortBy)
  const sortOrder = search.sortOrder ?? (trash ? 'desc' : defaultSortOrder)
  const shelfId = search.shelf ?? null
  const tagId = search.tag ?? null
  const author = search.author ?? null
  const series = search.series ?? null
  const format = search.format ?? null
  const readStatus = search.status ?? null

  const prefetchLibrary = useCallback(
    (patch: Partial<LibrarySearch>) => {
      const nextShelfId = 'shelf' in patch ? (patch.shelf ?? null) : shelfId
      const nextTagId = 'tag' in patch ? (patch.tag ?? null) : tagId
      const nextTrash = 'trash' in patch ? (patch.trash ?? false) : false
      const nextStatus = 'status' in patch ? (patch.status ?? null) : readStatus
      // Mirror navSearch's sort reset so the prefetched key matches the fetch
      const crossing = nextTrash !== trash
      const nextSortBy = crossing ? (nextTrash ? 'deletedAt' : defaultSortBy) : sortBy
      const nextSortOrder = crossing ? (nextTrash ? 'desc' : defaultSortOrder) : sortOrder
      void prefetchInfiniteBooks(queryClient, {
        pageSize: PAGE_SIZE,
        search: query,
        sortBy: nextSortBy,
        sortOrder: nextSortOrder,
        shelfId: nextShelfId,
        tagId: nextTagId,
        author: null,
        series: null,
        format,
        readStatus: nextStatus,
        trash: nextTrash,
      })
    },
    [queryClient, query, trash, defaultSortBy, defaultSortOrder, sortBy, sortOrder, shelfId, tagId, format, readStatus],
  )

  const [uploadOpen, setUploadOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BookListItem | null>(null)
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<BookListItem | null>(null)
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState<BookListItem | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const lastSelectIndexRef = useRef<number | null>(null)
  const selectionActive = selectionMode || selection.size > 0
  const deleteBook = useDeleteBook()
  const restoreBook = useRestoreBook()
  const permanentDeleteBook = usePermanentDeleteBook()
  const emptyTrash = useEmptyTrash()

  function toggleSelect(id: string, index?: number, shiftKey?: boolean) {
    const anchor = lastSelectIndexRef.current
    if (shiftKey && index !== undefined && anchor !== null && anchor !== index) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
      const rangeIds = allBooks.slice(from, to + 1).map((b) => b.id)
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
    setSelectionMode((v) => !v)
    clearSelection()
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
  const reorderShelves = useReorderShelves()
  const reorderTags = useReorderTags()
  // Drag-to-manual: a row drop materializes the visual order into sortOrder
  // and switches the default mode to 'manual' in the same gesture.
  const updateLibraryPrefs = useUpdateLibraryPrefs()
  // Which drag is in flight: drives the manual autoscroll (page for book
  // drags, sidebar nav for shelf/tag drags) and the overlay shape.
  const [dragKind, setDragKind] = useState<'book' | 'shelf' | 'tag' | null>(null)
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
      setDragKind(dragType === 'tag' ? 'tag' : 'shelf')
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
      const targetShelfId = resolveDropShelfId(String(over.id))
      // No-op when every dragged book already sits in the target shelf.
      const moved = payload.bookIds.filter((id) => {
        const book = allBooks.find((b) => b.id === id)
        return book ? book.shelfId !== targetShelfId : false
      })
      if (moved.length === 0) return
      moveBooksToShelf.mutate({ bookIds: moved, shelfId: targetShelfId })
      return
    }
    const dragType = (payload as { type?: unknown } | null)?.type
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
      reorderTags.mutate(next)
      updateLibraryPrefs.mutate({ tagSort: { mode: 'manual' } })
      return
    }
    if (dragType !== 'shelf') return
    // Shelf drag: active/over are shelf row ids (sortable); over may be the
    // uncategorized droppable or empty space, both of which reorder to no-op.
    const ordered = shelves.map((s) => s.id)
    const oldIndex = ordered.indexOf(String(active.id))
    const newIndex = ordered.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(ordered, oldIndex, newIndex)
    setShelfOrderOverride(next)
    setSettleShelfId(String(active.id))
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null
      setSettleShelfId(null)
    }, 160)
    reorderShelves.mutate(next)
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

  const { data, isLoading, isError, isPlaceholderData, isFetching, isFetchingNextPage, isFetchNextPageError, hasNextPage, fetchNextPage, refetch } = useInfiniteBooks({
    pageSize: PAGE_SIZE,
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
    // Server rejects trash queries while the feature is off; the redirect
    // effect below swaps the URL out before the next render settles.
  }, { enabled: !trash || trashEnabled })

  const allBooks = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data])
  const isEmpty = !isLoading && allBooks.length === 0

  const total = data?.pages[0]?.total ?? 0
  const totalSize = data?.pages[0]?.totalSize ?? 0

  const shelvesQuery = useShelves()
  const tagsQuery = useTags()
  const shelvesData = shelvesQuery.data
  const tagsData = tagsQuery.data
  // Local mirror of the shelf order: dnd-kit clears its drag state in the same
  // event as our onDragEnd, but the react-query cache update lands a render
  // later — without this the rows would flash back to the old order for a
  // frame. The override is applied synchronously on drag end and dropped once
  // the query catches up.
  const [shelfOrderOverride, setShelfOrderOverride] = useState<string[] | null>(null)
  useEffect(() => {
    setShelfOrderOverride(null)
  }, [shelvesData])
  const [tagOrderOverride, setTagOrderOverride] = useState<string[] | null>(null)
  useEffect(() => {
    setTagOrderOverride(null)
  }, [tagsData])
  // Must mirror LibrarySidebar's memo: handleDragEnd materializes this exact
  // visual order when a shelf/tag row is dropped.
  const shelves = useMemo(
    () => sortSidebarItems(applyShelfOrder(shelvesData?.data ?? [], shelfOrderOverride), libraryPrefs?.shelfSort),
    [shelvesData, shelfOrderOverride, libraryPrefs?.shelfSort],
  )
  const tags = useMemo(
    () => sortSidebarItems(applyTagOrder(tagsData?.data ?? [], tagOrderOverride), libraryPrefs?.tagSort),
    [tagsData, tagOrderOverride, libraryPrefs?.tagSort],
  )
  const activeShelfName = shelfId ? shelvesData?.data.find((s) => s.id === shelfId)?.name : undefined
  const activeTagName = tagId ? tagsData?.data.find((tag) => tag.id === tagId)?.name : undefined
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
            : (activeShelfName ?? activeTagName ?? _('library.allBooks'))

  const readStatusName = readStatus === 'wishlist'
    ? _('library.readStatusWishlist')
    : readStatus === 'reading'
      ? _('library.readStatusReading')
      : readStatus === 'idle'
        ? _('library.readStatusIdle')
        : readStatus === 'finished'
          ? _('library.readStatusFinished')
          : readStatus === 'abandoned'
            ? _('library.readStatusAbandoned')
            : undefined
  const libraryDocumentTitle = trash
    ? _('library.trash')
    : shelfId === 'none'
      ? `${_('app.name')} · ${_('library.uncategorized')}`
      : activeShelfName
        ? _('library.shelfDocumentTitle', { name: activeShelfName })
        : activeTagName
          ? _('library.tagDocumentTitle', { name: activeTagName })
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
        setSelection(new Set(allBooks.map((b) => b.id)))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectionActive, allBooks])

  useGlobalDragToggle(setUploadOpen)

  const navSearch = useCallback(
    (patch: Partial<LibrarySearch>) => {
      // The trash has its own default sort; URL sort params are meaningful only
      // within the list/trash domain they were set in, so drop them on crossing
      const nextTrash = 'trash' in patch ? (patch.trash ?? false) : trash
      const sortPatch = nextTrash !== trash ? { sortBy: undefined, sortOrder: undefined } : null
      navigate({ to: '/', search: { ...search, ...sortPatch, ...patch }, replace: true })
    },
    [navigate, search, trash],
  )

  // A shared/bookmarked ?trash=1 URL must not dead-end when the feature is
  // switched off (e.g. in another tab): bounce back to the plain library.
  useEffect(() => {
    if (trash && !trashEnabled) {
      navigate({ to: '/', search: { ...search, trash: undefined }, replace: true })
    }
  }, [trash, trashEnabled, navigate, search])

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
    if (isLoading || isPlaceholderData) return
    if (uncategorizedEmptyOnEntryRef.current === null) {
      uncategorizedEmptyOnEntryRef.current = total === 0
    } else if (!uncategorizedEmptyOnEntryRef.current && total === 0) {
      uncategorizedEmptyOnEntryRef.current = null
      navSearch({ shelf: undefined })
    }
  }, [shelfId, isLoading, isPlaceholderData, total, navSearch])

  const coverText = useUiStore((s) => s.coverText)
  const gridColumns = useUiStore((s) => s.gridColumns)
  const recentlyReadStyle = useUiStore((s) => s.recentlyReadStyle)

  const containerRef = useRef<HTMLDivElement>(null)
  const [dynColumns, setDynColumns] = useState(4)

  useEffect(() => {
    if (gridColumns !== 'auto') return
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      const gap = 20
      const itemWidth = 176
      setDynColumns(Math.min(6, Math.max(2, Math.floor((width + gap) / (itemWidth + gap)))))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [gridColumns])

  const columns = gridColumns === 'auto' ? dynColumns : Number(gridColumns)

  const endReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} autoScroll={false} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div className="flex min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
        <LibrarySidebar
          navSearch={navSearch}
          onPrefetchNavigation={prefetchLibrary}
          shelfId={shelfId}
          tagId={tagId}
          author={author}
          series={series}
          trash={trash}
          readOnly={isGuest}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
          navRef={sidebarNavRef}
          shelfOrderOverride={shelfOrderOverride}
          settleShelfId={settleShelfId}
          tagOrderOverride={tagOrderOverride}
          settleTagId={settleTagId}
        />

      <main className="flex min-w-0 flex-1 flex-col px-3 py-5 sm:px-4 sm:py-8 md:px-8">
        <LibraryHeader
          navSearch={navSearch}
          view={view}
          query={query}
          sortBy={sortBy}
          sortOrder={sortOrder}
          format={format}
          readStatus={readStatus}
          trash={trash}
          onUploadClick={isGuest ? undefined : () => setUploadOpen(true)}
          trashCount={total}
          bookSize={trash ? totalSize : undefined}
          trashCapBytes={trash ? trashCapBytes : undefined}
          onEmptyTrash={isGuest ? undefined : () => setEmptyTrashOpen(true)}
          selectionActive={selectionActive}
          onToggleSelectMode={isGuest ? undefined : toggleSelectionMode}
          onOpenNavigation={() => setMobileNavOpen(true)}
          title={viewTitle}
          bookCount={total}
          onResetMetadataFilter={metadataFilter ? () => navSearch({ author: undefined, series: undefined }) : undefined}
        />

        {(shelvesQuery.isError || tagsQuery.isError) && (
          <QueryErrorState
            className="py-4"
            isRetrying={shelvesQuery.isFetching || tagsQuery.isFetching}
            onRetry={() => Promise.all([shelvesQuery.refetch(), tagsQuery.refetch()])}
          />
        )}

        {!isGuest && recentlyReadStyle !== 'off' && !trash && !query && !metadataFilter && !selectionActive && <ReadingStatsCard />}
        {!isGuest && recentlyReadStyle !== 'off' && !trash && !query && !metadataFilter && !selectionActive && <RecentlyRead style={recentlyReadStyle} />}

        <div
          ref={containerRef}
          className={`min-h-0 flex-1 transition-opacity duration-150 ${isFetching && !isLoading ? 'opacity-65' : ''} ${selection.size > 0 ? 'pb-16' : ''}`}
        >
          {isLoading ? (
            <InitialLoading view={view} columns={columns} />
          ) : isError && !data ? (
            <QueryErrorState isRetrying={isFetching} onRetry={refetch} />
          ) : isEmpty ? (
            trash ? (
              <EmptyTrash />
            ) : (
              <EmptyLibrary />
            )
          ) : view === 'grid' ? (
            <VirtuosoGrid
              totalCount={allBooks.length}
              overscan={200}
              useWindowScroll
              components={GRID_COMPONENTS}
              style={{ ['--library-grid-cols' as string]: String(columns) } as CSSProperties}
              endReached={endReached}
              itemContent={(index) => {
                const book = allBooks[index]
                if (!book) return null
                if (trash) {
                  return (
                    <div
                      className={`rounded-xl ${selectionActive && selection.has(book.id) ? 'ring-2 ring-stone-900 ring-offset-2 ring-offset-stone-50 dark:ring-stone-100 dark:ring-offset-stone-950' : ''}`}
                    >
                      <BookCard
                        book={book}
                        selected={selection.has(book.id)}
                        selectionActive={selectionActive}
                        coverText={true}
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
                if (selectionActive) {
                  return (
                    <DraggableBookCard book={book} selection={selection} selectionActive disabled={isGuest}>
                      <div
                        className={`rounded-xl ${selection.has(book.id) ? 'ring-2 ring-stone-900 ring-offset-2 ring-offset-stone-50 dark:ring-stone-100 dark:ring-offset-stone-950' : ''}`}
                      >
                        <BookCard
                          book={book}
                          selected={selection.has(book.id)}
                          selectionActive={true}
                          coverText={coverText}
                          onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                          readOnly={isGuest}
                          onDelete={isGuest ? undefined : setDeleteTarget}
                          onShowDetails={setDetailTarget}
                        />
                      </div>
                    </DraggableBookCard>
                  )
                }
                return (
                  <DraggableBookCard book={book} selection={selection} selectionActive={false} disabled={isGuest}>
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
                        if (e.ctrlKey || e.metaKey || e.shiftKey) {
                          e.preventDefault()
                          toggleSelect(book.id, index, e.shiftKey)
                        }
                      }}
                      className="block rounded-xl"
                    >
                      <BookCard
                        book={book}
                        coverText={coverText}
                        onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                        readOnly={isGuest}
                        onDelete={isGuest ? undefined : setDeleteTarget}
                        onShowDetails={setDetailTarget}
                      />
                    </Link>
                  </DraggableBookCard>
                )
              }}
            />
          ) : (
            <Virtuoso
              totalCount={allBooks.length}
              overscan={200}
              useWindowScroll
              components={LIST_COMPONENTS}
              endReached={endReached}
              itemContent={(index) => {
                const book = allBooks[index]
                if (!book) return null
                if (trash) {
                  return (
                    <TrashListRow
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
                    book={book}
                    selection={selection}
                    selectionActive={selectionActive}
                    dragJustEndedRef={dragJustEndedRef}
                    onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                    readOnly={isGuest}
                    onDelete={isGuest ? undefined : setDeleteTarget}
                    onShowDetails={setDetailTarget}
                  />
                )
              }}
            />
          )}
        </div>

        {isFetchNextPageError ? (
          <QueryErrorState className="py-4" isRetrying={isFetchingNextPage} onRetry={fetchNextPage} />
        ) : isFetchingNextPage && (
          <p className="py-4 text-center text-xs text-stone-400">{_('reader.loading')}</p>
        )}
      </main>

      {!isGuest && selection.size > 0 && (
        <SelectionBar selectedIds={Array.from(selection)} onClear={clearSelection} onComplete={completeBatchAction} trash={trash} />
      )}

      {!isGuest && (
        <UploadSheet
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          shelfId={shelfId && shelfId !== 'none' ? shelfId : undefined}
          tagId={tagId ?? undefined}
        />
      )}

      <BookDetailDialog
        book={detailTarget}
        readOnly={isGuest}
        onClose={() => setDetailTarget(null)}
        onDelete={(b) => {
          setDetailTarget(null)
          setDeleteTarget(b)
        }}
      />

      {deleteTarget && (
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
            void deleteBook.mutateAsync({ id: target.id, title: target.title }).catch(() => undefined)
          }}
        />
      )}

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
              {totalSize > 0 && (
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
            void emptyTrash.mutateAsync().catch(() => undefined)
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
          <BookDragPreview bookIds={dragBookIds} books={allBooks} />
        </DragOverlay>
      )}
    </DndContext>
  )
}

function BookDragPreview({ bookIds, books }: { bookIds: string[]; books: BookListItem[] }) {
  const first = books.find((b) => b.id === bookIds[0])
  if (!first) return null
  const count = bookIds.length
  // The DragOverlay wrapper is sized to the measuring node and centered on the
  // cursor (official snapCenterToCursor); flex-centering the preview inside it
  // puts the cursor exactly at the preview's center. shrink-0 keeps the cover
  // at its own size when the measuring node is small (list-view cover thumb).
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative w-24 shrink-0 overflow-hidden rounded-xl shadow-xl shadow-stone-900/20 ring-1 ring-stone-900/10 dark:ring-white/10">
        <BookCover book={first} size="md" />
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
      <div className="mb-1 flex h-20 w-20 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-stone-200/70 dark:bg-stone-900 dark:ring-stone-800">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-300 dark:text-stone-600">
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
        <div className="mt-0.5 flex items-baseline gap-2">
          {book.author && (
            <span className="truncate text-xs text-stone-500 dark:text-stone-400">{book.author}</span>
          )}
          <TrashInfo book={book} className="shrink-0" />
        </div>
      </div>
      <span className="shrink-0 rounded border border-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:border-stone-700 dark:text-stone-500">
        {book.format}
      </span>
      {selectionActive ? (
        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          selected
            ? 'border-stone-900 bg-stone-900 dark:border-stone-100 dark:bg-stone-100'
            : 'border-stone-300 dark:border-stone-600'
        }`}>
          {selected && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-stone-900">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
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

export function ListItemWrapper({ book, selection, selectionActive, dragJustEndedRef, onToggleSelect, readOnly, onDelete, onShowDetails }: {
  book: BookListItem
  selection: Set<string>
  selectionActive: boolean
  dragJustEndedRef: React.MutableRefObject<boolean>
  readOnly: boolean
  onToggleSelect: (id: string, shiftKey?: boolean) => void
  onDelete?: (b: BookListItem) => void
  onShowDetails: (b: BookListItem) => void
}) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const selected = selection.has(book.id)
  const bookIds = selectionActive && selected ? Array.from(selection) : [book.id]
  // The measuring node is the cover thumbnail (small rect), not the full-width
  // row: the drag overlay wrapper is sized from it, so the preview follows the
  // cursor and edge-clamping keeps it on screen. Listeners still span the row.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `book:${book.id}`,
    data: { bookIds } satisfies BookDragPayload,
    disabled: readOnly,
  })

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    menu.openFromEvent(e)
  }

  const meta = (
    <div className="flex shrink-0 items-center gap-3">
      <ListItemInfo book={book} />
      <span className="rounded border border-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:border-stone-700 dark:text-stone-500">
        {book.format}
      </span>
    </div>
  )

  return (
    <div
      {...listeners}
      {...attributes}
      onContextMenu={handleContextMenu}
      className={isDragging ? 'select-none opacity-60' : 'select-none'}
    >
      {selectionActive ? (
        <div
          onClick={(e) => onToggleSelect(book.id, e.shiftKey)}
          className={`group flex cursor-pointer items-center gap-3.5 rounded-xl px-3 py-2.5 transition-all hover:bg-white hover:shadow-sm dark:hover:bg-stone-900 ${selected ? 'bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700' : ''}`}
        >
          <div ref={setNodeRef} className="shrink-0">
            <BookCover book={book} size="sm" />
          </div>
          <ListItemContent book={book} />
          {meta}
          <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            selected
              ? 'border-stone-900 bg-stone-900 dark:border-stone-100 dark:bg-stone-100'
              : 'border-stone-300 dark:border-stone-600'
          }`}>
            {selected && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-stone-900">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        </div>
      ) : (
        <Link
          to="/books/$id"
          params={{ id: book.id }}
          onClick={(e) => {
            if (dragJustEndedRef.current) {
              e.preventDefault()
              return
            }
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              e.preventDefault()
              onToggleSelect(book.id, e.shiftKey)
            }
          }}
          className="group flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-all hover:bg-white hover:shadow-sm dark:hover:bg-stone-900"
        >
          <div ref={setNodeRef} className="shrink-0">
            <BookCover book={book} size="sm" />
          </div>
          <ListItemContent book={book} />
          {meta}
          <div className="flex w-7 shrink-0 items-center justify-center opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
            <button
              ref={menu.btnRef}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                menu.toggleFromButton()
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label={_('library.moreActions')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </div>
        </Link>
      )}
      {menu.open && (
        <SmartMenu
          triggerRef={menu.btnRef}
          innerRef={menu.menuRef}
          position={menu.position(184, 250)}
          width={184}
          onClose={menu.close}
        >
          <ContextMenuContent book={book} readOnly={readOnly} onShowDetails={onShowDetails} onDelete={onDelete} onClose={menu.close} />
        </SmartMenu>
      )}
    </div>
  )
}

function ListItemContent({ book }: { book: BookListItem }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate font-serif text-sm font-medium text-stone-900 dark:text-stone-100">
          {book.title}
        </span>
        {book.pinnedAt && (
          <UnpinButton
            bookId={book.id}
            className="shrink-0 rounded-md p-1 text-stone-400 transition-all hover:bg-stone-200/70 hover:text-stone-700 md:opacity-0 md:group-hover:opacity-100 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200"
          >
            <PinIcon size={11} />
          </UnpinButton>
        )}
      </div>
      {book.author && (
        <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">{book.author}</div>
      )}
    </div>
  )
}

// Virtuoso components must be referentially stable: inline component types
// remount the whole virtual list DOM on every render. The dynamic column count
// reaches the grid List through a CSS variable set on the scroller style.
const GridList = forwardRef<HTMLDivElement, GridListProps>(function GridList({ style, children, ...props }, ref) {
  return (
    <div
      ref={ref}
      {...props}
      style={{
        ...style,
        display: 'grid',
        gridTemplateColumns: 'repeat(var(--library-grid-cols), minmax(0, 1fr))',
        gap: '20px',
      }}
    >
      {children}
    </div>
  )
})

const GridItem = forwardRef<HTMLDivElement, GridItemProps>(function GridItem({ children, ...props }, ref) {
  return (
    <div ref={ref} {...props}>
      {children}
    </div>
  )
})

const GRID_COMPONENTS: GridComponents = { List: GridList, Item: GridItem }

const ListItem = forwardRef<HTMLDivElement, ItemProps<unknown>>(function ListItem({ children, ...props }, ref) {
  return (
    <div ref={ref} {...props} style={{ padding: '4px 0' }}>
      {children}
    </div>
  )
})

const LIST_COMPONENTS: Components<unknown, unknown> = { Item: ListItem }

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
