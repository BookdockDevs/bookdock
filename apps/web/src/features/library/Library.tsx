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

import { useTranslation } from '@/hooks/useTranslation'
import { useUiStore } from '@/stores/ui.store'

import SmartMenu from '@/components/ui/SmartMenu'

import { indexRoute, type LibrarySearch } from '@/routes/index'

import BookCard from './components/BookCard'
import BookCover from './components/BookCover'
import { useContextMenu } from './components/use-context-menu'
import { ContextMenuContent } from './components/BookContextMenu'
import BookDetailDialog from './components/BookDetailDialog'
import DeleteConfirm from './components/DeleteConfirm'
import EmptyLibrary from './components/EmptyLibrary'
import LibraryHeader from './components/LibraryHeader'
import LibrarySidebar from './components/LibrarySidebar'
import ListItemInfo from './components/ListItemInfo'
import ReadingStatsCard from './components/ReadingStatsCard'
import RecentlyRead from './components/RecentlyRead'
import SelectionBar from './components/SelectionBar'
import UploadSheet from './components/UploadSheet'
import { applyShelfOrder, isBookDrag, resolveDropShelfId, type BookDragPayload } from './dnd'
import { useInfiniteBooks, useDeleteBook, useRestoreBook, usePermanentDeleteBook, useEmptyTrash, useShelves, useMoveBooksToShelf, useReorderShelves } from './hooks'

const PAGE_SIZE = 20

export default function Library() {
  const _ = useTranslation()
  const search = useSearch({ from: indexRoute.id })
  const navigate = useNavigate()

  const viewPref = useUiStore((s) => s.view)
  const sortByPref = useUiStore((s) => s.sortBy)
  const sortOrderPref = useUiStore((s) => s.sortOrder)
  // URL params win over the persisted preferences (bd-library-view/bd-sort-by/
  // bd-sort-order), so a linked/shared URL still controls its own view
  const view = search.view ?? viewPref
  const query = search.q ?? ''
  const sortBy = search.sortBy ?? sortByPref
  const sortOrder = search.sortOrder ?? sortOrderPref
  const shelfId = search.shelf ?? null
  const tagId = search.tag ?? null
  const author = search.author ?? null
  const series = search.series ?? null
  const format = search.format ?? null
  const readStatus = search.status ?? null
  const trash = search.trash ?? false

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

  const queryClient = useQueryClient()

  // Reading progress no longer bumps books.updatedAt and global staleTime is
  // Infinity, so the books cache is stale after a reading session. Refetch on mount.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['books'] })
  }, [queryClient])

  // Book drag-to-shelf: the in-flight drag payload drives the overlay and the
  // sidebar drop hints; dragJustEndedRef swallows the click that fires after a
  // completed drag so the dragged card does not navigate into the reader.
  const [dragBookIds, setDragBookIds] = useState<string[] | null>(null)
  const dragJustEndedRef = useRef(false)
  const moveBooksToShelf = useMoveBooksToShelf()
  const reorderShelves = useReorderShelves()
  // Which drag is in flight: drives the manual autoscroll (page for book
  // drags, sidebar nav for shelf drags) and the overlay shape.
  const [dragKind, setDragKind] = useState<'book' | 'shelf' | null>(null)
  // The shelf row that was just released: its transform reset gets a short
  // transition so it glides from the release position into its slot instead
  // of snapping (a snapped reset reads as a flicker).
  const [settleShelfId, setSettleShelfId] = useState<string | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
  }, [])
  const sidebarNavRef = useRef<HTMLDivElement | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragStart(event: DragStartEvent) {
    const payload = event.active.data.current as unknown
    if (isBookDrag(payload)) {
      setDragBookIds(payload.bookIds)
      setDragKind('book')
    } else {
      setDragKind('shelf')
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
  }

  function handleDragCancel() {
    endDrag()
  }

  // dnd-kit autoscroll is disabled: it scrolls the document too, which looks
  // broken when dragging a shelf near the sidebar bottom. Manual autoscroll
  // instead — the page for book drags, the sidebar nav for shelf drags.
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

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteBooks({
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
  })

  const allBooks = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data])
  const isEmpty = !isLoading && allBooks.length === 0

  const total = data?.pages[0]?.total ?? 0

  const { data: shelvesData } = useShelves()
  // Local mirror of the shelf order: dnd-kit clears its drag state in the same
  // event as our onDragEnd, but the react-query cache update lands a render
  // later — without this the rows would flash back to the old order for a
  // frame. The override is applied synchronously on drag end and dropped once
  // the query catches up.
  const [shelfOrderOverride, setShelfOrderOverride] = useState<string[] | null>(null)
  useEffect(() => {
    setShelfOrderOverride(null)
  }, [shelvesData])
  const shelves = useMemo(
    () => applyShelfOrder(shelvesData?.data ?? [], shelfOrderOverride),
    [shelvesData, shelfOrderOverride],
  )
  const activeShelfName = shelfId ? shelvesData?.data.find((s) => s.id === shelfId)?.name : undefined
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
          : (activeShelfName ?? _('library.allBooks'))

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
      navigate({ to: '/', search: { ...search, ...patch }, replace: true })
    },
    [navigate, search],
  )

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
      const itemWidth = 160
      setDynColumns(Math.max(2, Math.floor((width + gap) / (itemWidth + gap))))
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
          shelfId={shelfId}
          tagId={tagId}
          author={author}
          series={series}
          trash={trash}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
          navRef={sidebarNavRef}
          shelfOrderOverride={shelfOrderOverride}
          settleShelfId={settleShelfId}
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
          onUploadClick={() => setUploadOpen(true)}
          trashCount={total}
          onEmptyTrash={() => setEmptyTrashOpen(true)}
          selectionActive={selectionActive}
          onToggleSelectMode={toggleSelectionMode}
          onOpenNavigation={() => setMobileNavOpen(true)}
          title={viewTitle}
          bookCount={total}
          onResetMetadataFilter={metadataFilter ? () => navSearch({ author: undefined, series: undefined }) : undefined}
        />

        {recentlyReadStyle !== 'off' && !trash && !query && !metadataFilter && !selectionActive && <ReadingStatsCard />}
        {recentlyReadStyle !== 'off' && !trash && !query && !metadataFilter && !selectionActive && <RecentlyRead style={recentlyReadStyle} />}

        <div ref={containerRef} className={`min-h-0 flex-1 ${selection.size > 0 ? 'pb-16' : ''}`}>
          {isLoading ? (
            <InitialLoading />
          ) : isEmpty ? (
            trash ? (
              <EmptyTrash />
            ) : (
              <EmptyLibrary />
            )
          ) : trash ? (
            <TrashGrid
              books={allBooks}
              selection={selection}
              selectionActive={selectionActive}
              onToggleSelect={(id, index, shiftKey) => toggleSelect(id, index, shiftKey)}
              onRestore={(b) => {
                deselect(b.id)
                void restoreBook.mutateAsync(b.id).catch(() => undefined)
              }}
              onPermanentDelete={setPermanentDeleteTarget}
            />
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
                if (selectionActive) {
                  return (
                    <DraggableBookCard book={book} selection={selection} selectionActive>
                      <div
                        className={`rounded-xl ${selection.has(book.id) ? 'ring-2 ring-stone-900 ring-offset-2 ring-offset-stone-50 dark:ring-stone-100 dark:ring-offset-stone-950' : ''}`}
                      >
                        <BookCard
                          book={book}
                          selected={selection.has(book.id)}
                          selectionActive={true}
                          coverText={coverText}
                          onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                          onDelete={setDeleteTarget}
                          onShowDetails={setDetailTarget}
                        />
                      </div>
                    </DraggableBookCard>
                  )
                }
                return (
                  <DraggableBookCard book={book} selection={selection} selectionActive={false}>
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
                        onDelete={setDeleteTarget}
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
                return (
                  <ListItemWrapper
                    book={book}
                    selection={selection}
                    selectionActive={selectionActive}
                    dragJustEndedRef={dragJustEndedRef}
                    onToggleSelect={(id, shiftKey) => toggleSelect(id, index, shiftKey)}
                    onDelete={setDeleteTarget}
                    onShowDetails={setDetailTarget}
                  />
                )
              }}
            />
          )}
        </div>

        {isFetchingNextPage && (
          <p className="py-4 text-center text-xs text-stone-400">{_('reader.loading')}</p>
        )}
      </main>

      {selection.size > 0 && (
        <SelectionBar selectedIds={Array.from(selection)} onClear={clearSelection} onComplete={completeBatchAction} trash={trash} />
      )}

      <UploadSheet
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        shelfId={shelfId && shelfId !== 'none' ? shelfId : undefined}
        tagId={tagId ?? undefined}
      />

      <BookDetailDialog
        book={detailTarget}
        onClose={() => setDetailTarget(null)}
        onDelete={(b) => {
          setDetailTarget(null)
          setDeleteTarget(b)
        }}
      />

      <DeleteConfirm
        open={!!deleteTarget}
        bookTitle={deleteTarget?.title}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget
          if (!target) return
          setDeleteTarget(null)
          void deleteBook.mutateAsync(target.id).catch(() => undefined)
        }}
      />

      <DeleteConfirm
        open={!!permanentDeleteTarget}
        title={_('library.permanentDelete')}
        message={
          <>
            {_('library.permanentDeleteConfirm')}
            <span className="mt-1 block truncate text-stone-700 dark:text-stone-200">{'\u300c'}{permanentDeleteTarget?.title ?? ''}{'\u300d'}</span>
          </>
        }
        confirmLabel={_('library.permanentDelete')}
        onCancel={() => setPermanentDeleteTarget(null)}
        onConfirm={() => {
          const target = permanentDeleteTarget
          if (!target) return
          setPermanentDeleteTarget(null)
          deselect(target.id)
          void permanentDeleteBook.mutateAsync(target.id).catch(() => undefined)
        }}
      />

      <DeleteConfirm
        open={emptyTrashOpen}
        title={_('library.emptyTrash')}
        message={_('library.emptyTrashConfirm')}
        confirmLabel={_('library.emptyTrash')}
        onCancel={() => setEmptyTrashOpen(false)}
        onConfirm={() => {
          setEmptyTrashOpen(false)
          void emptyTrash.mutateAsync().catch(() => undefined)
        }}
      />
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
  children,
}: {
  book: BookListItem
  selection: Set<string>
  selectionActive: boolean
  children: ReactNode
}) {
  // Dragging a selected card in selection mode carries the whole selection.
  const bookIds = selectionActive && selection.has(book.id) ? Array.from(selection) : [book.id]
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `book:${book.id}`,
    data: { bookIds } satisfies BookDragPayload,
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

function InitialLoading() {
  const _ = useTranslation()
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <p className="text-sm text-stone-400">{_('reader.loading')}</p>
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

function TrashGrid({ books, selection, selectionActive, onToggleSelect, onRestore, onPermanentDelete }: {
  books: BookListItem[]
  selection: Set<string>
  selectionActive: boolean
  onToggleSelect: (id: string, index: number, shiftKey?: boolean) => void
  onRestore: (b: BookListItem) => void
  onPermanentDelete: (b: BookListItem) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
      {books.map((book, index) => (
        <div
          key={book.id}
          className={`rounded-xl ${selectionActive && selection.has(book.id) ? 'ring-2 ring-stone-900 ring-offset-2 ring-offset-stone-50 dark:ring-stone-100 dark:ring-offset-stone-950' : ''}`}
        >
          <BookCard
            book={book}
            selected={selection.has(book.id)}
            selectionActive={selectionActive}
            onToggleSelect={(id, shiftKey) => onToggleSelect(id, index, shiftKey)}
            onRestore={onRestore}
            onPermanentDelete={onPermanentDelete}
          />
        </div>
      ))}
    </div>
  )
}

export function ListItemWrapper({ book, selection, selectionActive, dragJustEndedRef, onToggleSelect, onDelete, onShowDetails }: {
  book: BookListItem
  selection: Set<string>
  selectionActive: boolean
  dragJustEndedRef: React.MutableRefObject<boolean>
  onToggleSelect: (id: string, shiftKey?: boolean) => void
  onDelete: (b: BookListItem) => void
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
                menu.openFromButton()
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
          innerRef={menu.menuRef}
          position={menu.position(184, 250)}
          width={184}
          onClose={menu.close}
        >
          <ContextMenuContent book={book} onShowDetails={onShowDetails} onDelete={onDelete} onClose={menu.close} />
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
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400 dark:text-stone-500">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
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
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        setOpen(true)
        if (timer.current) clearTimeout(timer.current)
      }
    }
    const onDragLeave = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setOpen(false), 200)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [setOpen])
}
