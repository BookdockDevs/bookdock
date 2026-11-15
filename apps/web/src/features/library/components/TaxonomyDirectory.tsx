import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDndContext, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'

import type { ClientCategoryView, ClientTaxonomyView } from '@bookdock/shared'

import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { overlayTaxonomyDeviceCounts } from '@/features/local-library/catalog-view'
import { useDataAuthority } from '@/features/reading-data/data-authority'
import { catalogQueryKey } from '@/features/reading-data/catalog'
import { applyShelfOrder, applyTagOrder } from '../dnd'

import QueryErrorState from '@/components/ui/QueryErrorState'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/hooks/useTranslation'
import type { LibrarySearch } from '@/routes/index'
import { useAuthStore } from '@/stores/auth.store'

import {
  useClearLibraryCategory, useClearLibraryTag, useDeleteShelf,
  useDeviceMembershipCounts, useLibraryCategories, useLibraryPrefs, useLibraryTags, useReorderLibraryCategories, useReorderLibraryTags,
  useReorderShelves, useShelves, useTags, useToggleShelfHidden, useToggleShelfPin,
  useUpdateLibraryCategory, useUpdateLibraryPrefs, useUpdateLibraryTag,
} from '../hooks'
import { sortSidebarItems } from '../sort-modes'
import { sortCategories } from '../taxonomy'
import CategoryValueDialog from './CategoryValueDialog'
import ShelfDialog from './ShelfDialog'
import TagDialog from './TagDialog'
import TaxonomyEntry from './TaxonomyEntry'
import TaxonomyEmptyState from './TaxonomyEmptyState'
import TaxonomyIcon from './TaxonomyIcon'
import TaxonomySelectionBar, { type TaxonomySelectionAction } from './TaxonomySelectionBar'

interface TaxonomyDirectoryProps {
  libraryId: string | null
  privateLibraryId: string | null
  sessionKey: string
  panel: 'shelves' | 'categories' | 'tags'
  source: 'local' | 'server' | null
  canManage: boolean
  navSearch: (patch: Partial<LibrarySearch>) => void
  onOpenNavigation: () => void
}

const directoryLookups = new Map<string, Partial<Record<'shelves' | 'categories' | 'tags', string>>>()

function PromoteCardDropZone() {
  const _ = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id: 'directory:promote-to-root' })
  return (
    <section
      ref={setNodeRef}
      className={cn(
        'min-w-0 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-5 px-4 text-center transition-all select-none min-h-[96px]',
        isOver
          ? 'border-stone-900 bg-stone-100/90 text-stone-900 shadow-md ring-2 ring-stone-900/20 dark:border-stone-100 dark:bg-stone-800 dark:text-stone-100'
          : 'border-stone-300 bg-stone-50/40 text-stone-500 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900/20 dark:text-stone-400',
      )}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
      <span className="text-xs font-semibold">{_('library.dropToPromoteCategory')}</span>
      <span className="text-[11px] text-stone-400 dark:text-stone-500">{_('library.dropToPromoteHint')}</span>
    </section>
  )
}

function RootCategorySection({
  root,
  subcategories,
  entry,
  isDraggingSubcategory,
  draggedParentId,
}: {
  root: ClientCategoryView
  subcategories: ClientCategoryView[]
  entry: (row: ClientCategoryView) => React.ReactNode
  isDraggingSubcategory: boolean
  draggedParentId: string | null
}) {
  const _ = useTranslation()
  const { setNodeRef } = useDroppable({ id: `directory:root-container:${root.id}` })
  const { over } = useDndContext()
  const overId = over ? String(over.id) : null
  const isOverThisRoot = Boolean(
    overId && (
      overId === `directory:root-container:${root.id}`
      || overId === `directory:${root.id}`
      || subcategories.some((child) => `directory:${child.id}` === overId)
    ),
  )
  const isTargetRoot = isDraggingSubcategory && isOverThisRoot && root.id !== draggedParentId
  return (
    <section
      ref={setNodeRef}
      className={cn(
        'min-w-0 rounded-xl border border-stone-200/80 bg-white p-2.5 shadow-sm transition-all dark:border-stone-800/80 dark:bg-stone-900/40',
        isTargetRoot && 'ring-2 ring-stone-900 bg-stone-100/80 shadow-md dark:ring-stone-100 dark:bg-stone-800',
      )}
    >
      {entry(root)}
      {subcategories.length > 0 && (
        <SortableContext items={subcategories.map((row) => `directory:${row.id}`)} strategy={verticalListSortingStrategy}>
          <div className="mt-1 flex flex-col gap-1 pl-3.5 ml-2 border-l-2 border-stone-100 dark:border-stone-800/70">
            {subcategories.map((child) => entry(child))}
          </div>
        </SortableContext>
      )}
      {isTargetRoot && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border-2 border-dashed border-stone-400 bg-stone-50/90 py-2 px-3 text-xs font-medium text-stone-800 animate-in fade-in-50 dark:border-stone-500 dark:bg-stone-800/90 dark:text-stone-100">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>{_('library.moveToCategoryAsSub', { name: root.name })}</span>
        </div>
      )}
    </section>
  )
}

export default function TaxonomyDirectory({ libraryId, privateLibraryId, sessionKey, panel, source, canManage, navSearch, onOpenNavigation }: TaxonomyDirectoryProps) {
  const _ = useTranslation()
  const local = useDataAuthority()
  const queryClient = useQueryClient()
  const [batchPending, setBatchPending] = useState(false)
  const batchLock = useRef(false)
  const [batchDeleting, setBatchDeleting] = useState(false)
  // Same tree the sidebar shows: the account's when there is one (the vault
  // mirror follows it), the vault's own for a guest. Counts include device
  // books, because they sit on the same shelf.
  const signedIn = useAuthStore((state) => Boolean(state.user))
  const deviceCounts = useDeviceMembershipCounts({ enabled: !libraryId })
  const overlayCounts = !libraryId && signedIn ? deviceCounts : undefined
  const shelvesQuery = useShelves({ fallbackAnonymous: !libraryId })
  const tagsQuery = useTags({ fallbackAnonymous: !libraryId })
  const categoryLibraryId = libraryId ?? privateLibraryId
  const categoriesQuery = useLibraryCategories(categoryLibraryId)
  const libraryTagsQuery = useLibraryTags(libraryId)
  const prefs = useLibraryPrefs()
  const updatePrefs = useUpdateLibraryPrefs()
  const [lookup, setLookup] = useState(() => directoryLookups.get(sessionKey) ?? {})
  const [selecting, setSelecting] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const [shelfOrderOverride, setShelfOrderOverride] = useState<string[] | null>(null)
  const [tagOrderOverride, setTagOrderOverride] = useState<string[] | null>(null)
  const [categoryOrderOverride, setCategoryOrderOverride] = useState<string[] | null>(null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const dragJustEnded = useRef(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [shelfDialog, setShelfDialog] = useState<{ id?: string; name?: string } | null>(null)
  const [tagDialog, setTagDialog] = useState<{ id?: string; name?: string } | null>(null)
  const [categoryDialog, setCategoryDialog] = useState<{ path: string[]; name: string } | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string; tag: boolean } | null>(null)
  const [deletingPending, setDeletingPending] = useState(false)
  const [orderingPending, setOrderingPending] = useState(false)
  const deleteShelf = useDeleteShelf()
  const clearCategory = useClearLibraryCategory()
  const clearTag = useClearLibraryTag()
  const updateCategory = useUpdateLibraryCategory()
  const updateTag = useUpdateLibraryTag()
  const shelfHidden = useToggleShelfHidden()
  const shelfPin = useToggleShelfPin()
  const reorderCategories = useReorderLibraryCategories()
  const reorderLibraryTags = useReorderLibraryTags()
  const reorderShelves = useReorderShelves()
  const categories = useMemo(
    () => {
      if (panel !== 'categories') return []
      const server = categoriesQuery.data?.data ?? []
      const device = overlayCounts?.taxonomy.categories ?? []
      const base = (libraryId || source === 'server')
        ? server
        : source === 'local'
          ? device
          : (() => {
              const merged = new Map(server.map((item) => [item.id, item]))
              for (const item of device) {
                const existing = merged.get(item.id)
                merged.set(item.id, existing ? { ...existing, bookCount: existing.bookCount + item.bookCount, subtreeBookCount: existing.subtreeBookCount + item.subtreeBookCount } : item)
              }
              return [...merged.values()]
            })()
      return sortCategories(applyShelfOrder(base, categoryOrderOverride), prefs?.categorySort ?? prefs?.shelfSort)
    },
    [categoriesQuery.data, overlayCounts?.taxonomy.categories, prefs?.categorySort, prefs?.shelfSort, panel, libraryId, source, categoryOrderOverride],
  )
  const shelves = useMemo(
    () => sortSidebarItems(applyShelfOrder(overlayTaxonomyDeviceCounts(shelvesQuery.data?.data ?? [], overlayCounts?.shelves), shelfOrderOverride), prefs?.shelfSort),
    [shelvesQuery.data, overlayCounts?.shelves, prefs?.shelfSort, shelfOrderOverride],
  )
  const tags = useMemo(
    () => {
      const server = libraryId ? libraryTagsQuery.data?.data ?? [] : tagsQuery.data?.data ?? []
      const device = overlayCounts?.taxonomy.tags ?? []
      const base = (libraryId || source === 'server')
        ? server
        : source === 'local'
          ? device
          : (() => {
              const merged = new Map(server.map((item) => [item.id, item]))
              for (const item of device) {
                const existing = merged.get(item.id)
                merged.set(item.id, existing ? { ...existing, bookCount: existing.bookCount + item.bookCount } : item)
              }
              return [...merged.values()]
            })()
      return sortSidebarItems(applyTagOrder(base, tagOrderOverride), prefs?.tagSort)
    },
    [libraryId, libraryTagsQuery.data, tagsQuery.data, overlayCounts?.taxonomy.tags, prefs?.tagSort, source, tagOrderOverride],
  )
  const draggedCategory = useMemo(() => {
    if (panel !== 'categories' || !activeDragId) return null
    const entryId = activeDragId.replace(/^directory:/, '')
    return categories.find((c) => c.id === entryId) ?? null
  }, [panel, activeDragId, categories])
  const draggedItem = useMemo(() => {
    if (!activeDragId) return null
    const entryId = activeDragId.replace(/^directory:/, '')
    if (panel === 'categories') return categories.find((c) => c.id === entryId) ?? null
    if (panel === 'tags') return tags.find((t) => t.id === entryId) ?? null
    return shelves.find((s) => s.id === entryId) ?? null
  }, [activeDragId, panel, categories, tags, shelves])
  const isDraggingSubcategory = Boolean(draggedCategory?.parentId)
  const term = (lookup[panel] ?? '').trim().toLocaleLowerCase()
  const matches = (name: string) => name.toLocaleLowerCase().includes(term)
  const query = panel === 'tags' ? (libraryId ? libraryTagsQuery : tagsQuery) : panel === 'categories' ? categoriesQuery : shelvesQuery
  const noun = panel === 'tags' ? 'Tags' : panel === 'categories' ? 'Categories' : 'Shelves'

  const entries = panel === 'tags' ? tags : panel === 'categories' ? categories : shelves
  const showEmptyState = query.isSuccess && entries.length === 0 && term.length === 0
  const selectedRows = entries.filter((row) => selection.has(row.id))
  const matchingRows = entries.filter((row) => matches(row.name))

  async function applyBatch(action: TaxonomySelectionAction) {
    if (!canManage || batchLock.current || query.isLoading || query.isError || selectedRows.length === 0) return
    batchLock.current = true
    setBatchPending(true)
    const failed = new Set<string>()
    const partial = new Set<string>()
    const markPartial = (result: unknown, rowId: string) => {
      if (result && typeof result === 'object' && 'partial' in result && result.partial === true) {
        failed.add(rowId)
        partial.add(rowId)
      }
    }
    const snapshot = [...selectedRows]
    // Child category values are cleared first while the selected root path is still stable.
    if (action === 'delete' && panel === 'categories') snapshot.sort((a, b) => Number('parentId' in b && Boolean(b.parentId)) - Number('parentId' in a && Boolean(a.parentId)))
    try {
      for (const row of snapshot) {
        try {
          if (action === 'delete') {
            if (panel === 'shelves') await deleteShelf.mutateAsync(row.id)
            else if (panel === 'categories') {
              const category = categories.find((item) => item.id === row.id)
              if (category) markPartial(await clearCategory.mutateAsync({ libraryId: categoryLibraryId, path: category.path, source, suppressPartialNotification: true }), row.id)
            } else markPartial(await clearTag.mutateAsync({ libraryId, name: row.name, source, suppressPartialNotification: true }), row.id)
          } else {
            const patch = action === 'pin' || action === 'unpin' ? { pinned: action === 'pin' } : { hidden: action === 'hide' }
            if (panel === 'categories') {
              const category = categories.find((item) => item.id === row.id)
              if (category) markPartial(await updateCategory.mutateAsync({ libraryId: categoryLibraryId, path: category.path, source, patch, suppressPartialNotification: true }), row.id)
            } else if (panel === 'tags') markPartial(await updateTag.mutateAsync({ libraryId, name: row.name, source, patch, suppressPartialNotification: true }), row.id)
            else if (action === 'pin' || action === 'unpin') await shelfPin.mutateAsync({ id: row.id, pinned: action === 'pin' })
            else await shelfHidden.mutateAsync({ id: row.id, hidden: action === 'hide' })
          }
        } catch {
          failed.add(row.id)
        }
      }
      setSelection(failed)
      if (local) void queryClient.invalidateQueries({ queryKey: catalogQueryKey(local.scope, 'list').slice(0, -1) })
      setBatchDeleting(false)
      const succeeded = snapshot.length - failed.size
      if (partial.size) {
        notify.warning({ key: 'library.taxonomyBatchSourcePartial', params: { succeeded, partial: partial.size, failed: failed.size - partial.size } })
      } else if (failed.size) {
        const showResult = succeeded > 0 ? notify.warning : notify.error
        showResult({ key: 'library.taxonomyBatchPartial', params: { succeeded, failed: failed.size } })
      }
      else notify.success({ key: 'library.taxonomyBatchSucceeded', params: { count: succeeded } })
      const keys = local ? [] : [['shelves'], ['tags'], ['books'], ['book'], ['batch-selection'], ...(categoryLibraryId ? [['libraries', categoryLibraryId, 'categories']] : []), ...(libraryId ? [['libraries', libraryId, 'tags'], ['libraries', libraryId, 'catalog']] : [])]
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
    } finally {
      batchLock.current = false
      setBatchPending(false)
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null)
    if (!canManage || selecting || orderingPending) return
    dragJustEnded.current = true
    setTimeout(() => { dragJustEnded.current = false }, 0)
    if (!event.over) return

    const activeEntryId = (event.active.data.current?.entryId as string | undefined) ?? String(event.active.id).replace(/^directory:/, '')
    const overId = String(event.over.id)
    const overEntryId = (event.over.data.current?.entryId as string | undefined) ?? overId.replace(/^directory:(root-container:)?/, '')

    if (panel === 'categories') {
      const dragged = categories.find((c) => c.id === activeEntryId)
      if (!dragged) return

      // Drop on root plane (outside cards) or explicit promote drop target
      if (overId === 'directory:root-plane' || overId === 'directory:promote-to-root') {
        if (dragged.parentId) {
          try {
            await updateCategory.mutateAsync({
              libraryId: categoryLibraryId,
              path: dragged.path,
              source,
              patch: { parentPath: null },
            })
          } catch {
            // Handled by mutation error notification
          }
        }
        return
      }

      // If dragged is a subcategory
      if (dragged.parentId) {
        // Dropped onto a root category (or another root category's container or another root's child)
        const target = categories.find((c) => c.id === overEntryId)
        if (target) {
          const targetParentId = target.parentId ?? target.id
          if (targetParentId !== dragged.parentId) {
            const targetRoot = categories.find((c) => c.id === targetParentId)
            if (targetRoot) {
              try {
                await updateCategory.mutateAsync({
                  libraryId: categoryLibraryId,
                  path: dragged.path,
                  source,
                  patch: { parentPath: targetRoot.path },
                })
              } catch {
                // Handled by mutation
              }
              return
            }
          }
        }
      }

      if (activeEntryId === overEntryId) return

      // Sibling reorder (root with root, or child with child under same parent)
      const target = categories.find((c) => c.id === overEntryId)
      if (!target) return
      if (Boolean(dragged.parentId) !== Boolean(target.parentId)) return
      if (dragged.parentId && dragged.parentId !== target.parentId) return

      const siblings = categories.filter((c) => c.parentId === dragged.parentId)
      const ids = siblings.map((c) => c.id)
      const oldIndex = ids.indexOf(dragged.id)
      const newIndex = ids.indexOf(target.id)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      const moved = arrayMove(ids, oldIndex, newIndex)
      let pos = 0
      const complete = categories.map((c) => ids.includes(c.id) ? moved[pos++]! : c.id)
      setCategoryOrderOverride(complete)
      setOrderingPending(true)
      try {
        const deviceKeys = new Set((overlayCounts?.taxonomy.categories ?? []).map((c) => c.id))
        const serverKeys = new Set((categoriesQuery.data?.data ?? []).map((c) => c.id))
        await reorderCategories.mutateAsync({
          libraryId: categoryLibraryId,
          keys: complete,
          source,
          localKeys: source === null ? complete.filter((key) => deviceKeys.has(key)) : undefined,
          serverKeys: source === null ? complete.filter((key) => serverKeys.has(key)) : undefined,
        })
        updatePrefs.mutate({ categorySort: { mode: 'manual' } })
      } catch {
        setCategoryOrderOverride(null)
      } finally {
        setOrderingPending(false)
      }
      return
    }

    if (activeEntryId === overEntryId) return

    if (panel === 'tags') {
      const ordered = tags.map((t) => t.id)
      const oldIndex = ordered.indexOf(activeEntryId)
      const newIndex = ordered.indexOf(overEntryId)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      const next = arrayMove(ordered, oldIndex, newIndex)
      setTagOrderOverride(next)
      setOrderingPending(true)
      try {
        const deviceNames = new Set((overlayCounts?.taxonomy.tags ?? []).map((t) => t.name))
        const serverNames = new Set((libraryId ? libraryTagsQuery.data?.data : tagsQuery.data?.data)?.map((t) => t.name) ?? [])
        await reorderLibraryTags.mutateAsync({
          libraryId,
          names: next,
          source,
          localNames: source === null ? next.filter((name) => deviceNames.has(name)) : undefined,
          serverNames: source === null ? next.filter((name) => serverNames.has(name)) : undefined,
        })
        updatePrefs.mutate({ tagSort: { mode: 'manual' } })
      } catch {
        setTagOrderOverride(null)
      } finally {
        setOrderingPending(false)
      }
      return
    }

    if (panel === 'shelves') {
      const ordered = shelves.map((s) => s.id)
      const oldIndex = ordered.indexOf(activeEntryId)
      const newIndex = ordered.indexOf(overEntryId)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      const next = arrayMove(ordered, oldIndex, newIndex)
      setShelfOrderOverride(next)
      setOrderingPending(true)
      try {
        await reorderShelves.mutateAsync(next)
        updatePrefs.mutate({ shelfSort: { mode: 'manual' } })
      } catch {
        setShelfOrderOverride(null)
      } finally {
        setOrderingPending(false)
      }
    }
  }

  function entry(row: ClientTaxonomyView | ClientCategoryView | ClientTaxonomyView, isTag = false) {
    const category = panel === 'categories' && !isTag ? categories.find((item) => item.id === row.id) : undefined
    const parent = category?.parentId ? categories.find((item) => item.id === category.parentId) : undefined
    const count = category && !category.parentId ? category.subtreeBookCount : row.bookCount
    return <TaxonomyEntry key={row.id} row={{ ...row, bookCount: count }} isTag={isTag} isCategory={panel === 'categories'} directory directoryHeading={Boolean(category && !category.parentId)} sortableId={`directory:${row.id}`}
      inheritedHidden={Boolean(parent?.hidden)} readOnly={!canManage} selecting={selecting} selected={selection.has(row.id)} orderingPending={orderingPending || batchPending}
      title={category ? category.path.join(' / ') : row.name}
      onPromoteToRoot={category?.parentId && canManage ? () => {
        void updateCategory.mutateAsync({
          libraryId: categoryLibraryId,
          path: category.path,
          source,
          patch: { parentPath: null },
        })
      } : undefined}
      onClick={() => {
        if (dragJustEnded.current || batchLock.current) return
        if (selecting) {
          setSelection((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next })
        } else navSearch(isTag ? { tag: row.id, shelf: undefined, category: undefined, categoryScope: undefined, directory: undefined } : category ? { category: row.id, shelf: undefined, tag: undefined, categoryScope: 'subtree', directory: undefined } : { shelf: row.id, category: undefined, tag: undefined, categoryScope: undefined, directory: undefined })
      }}
      onEdit={() => isTag ? setTagDialog({ id: row.name, name: row.name }) : category ? setCategoryDialog({ path: category.path, name: row.name }) : setShelfDialog({ id: row.id, name: row.name })}
      onDelete={() => setDeleting({ id: row.id, name: row.name, tag: isTag })}
      onToggleHidden={() => {
        if (panel === 'categories') {
          if (category) updateCategory.mutate({ libraryId: categoryLibraryId, path: category.path, source, patch: { hidden: !row.hidden } })
        } else if (libraryId) {
          if (isTag) updateTag.mutate({ libraryId, name: row.name, source, patch: { hidden: !row.hidden } })
        } else if (isTag) updateTag.mutate({ libraryId: null, name: row.name, source, patch: { hidden: !row.hidden } })
        else shelfHidden.mutate({ id: row.id, hidden: !row.hidden })
      }}
      onTogglePin={() => {
        if (panel === 'categories') {
          if (category) updateCategory.mutate({ libraryId: categoryLibraryId, path: category.path, source, patch: { pinned: !row.pinned } })
        } else if (libraryId) {
          if (isTag) updateTag.mutate({ libraryId, name: row.name, source, patch: { pinned: !row.pinned } })
        } else if (isTag) updateTag.mutate({ libraryId: null, name: row.name, source, patch: { pinned: !row.pinned } })
        else shelfPin.mutate({ id: row.id, pinned: !row.pinned })
      }} />
  }

  const isTag = panel === 'tags'
  const title = isTag
    ? _('library.allTags')
    : panel === 'categories'
      ? _('library.allCategories')
      : _('library.allShelves')
  const count = isTag
    ? tags.length
    : panel === 'categories'
      ? categories.length
      : shelves.length
  const countSubtitle = isTag
    ? _('library.tagCount', { count })
    : panel === 'categories'
      ? _('library.categoryCount', { count })
      : _('library.shelfCount', { count })

  return <section className={`flex min-h-0 flex-1 flex-col ${selecting ? 'pb-24' : ''}`}>
    <header className="mb-6 md:mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 md:items-end md:gap-x-6 md:gap-y-4">
        <div className="flex w-full min-w-0 items-center gap-2 md:w-auto md:flex-none">
          {onOpenNavigation && (
            <button
              type="button"
              aria-label={_('library.openNavigation')}
              title={_('library.openNavigation')}
              onClick={onOpenNavigation}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-900 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-100 md:hidden"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <div className="min-w-0">
            <h1 className="truncate font-serif text-2xl font-semibold text-stone-900 dark:text-stone-50">
              {title}
            </h1>
            <p className="mt-1 text-xs tabular-nums text-stone-400 dark:text-stone-500">
              {countSubtitle}
            </p>
          </div>
        </div>

        <div className="flex w-full min-w-0 flex-1 flex-wrap items-center justify-end gap-2 md:w-auto">
          <div className="relative min-w-0 flex-1 sm:min-w-48 sm:max-w-72 md:max-w-80">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              disabled={batchPending}
              type="text"
              aria-label={_(`library.find${noun}`)}
              placeholder={_(`library.find${noun}`)}
              value={lookup[panel] ?? ''}
              onChange={(event) => {
                const next = { ...lookup, [panel]: event.target.value }
                directoryLookups.set(sessionKey, next)
                setLookup(next)
              }}
              className="h-10 w-full appearance-none rounded-xl border border-stone-200 bg-white pl-10 pr-3 text-sm text-stone-700 outline-none transition-all placeholder:text-stone-400 focus:border-stone-400 focus:ring-4 focus:ring-stone-900/5 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-600 dark:focus:ring-white/5"
            />
          </div>

          <button type="button" disabled={batchPending} aria-label={_('library.selectMode')} title={_('library.selectMode')} aria-pressed={selecting}
            onClick={() => { setSelecting(!selecting); setSelection(new Set()) }}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${selecting
              ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
              : 'border-stone-200 bg-white text-stone-400 hover:border-stone-300 hover:text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700 dark:hover:text-stone-200'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </button>
          {canManage && panel === 'shelves' && (
            <>
              <button
                type="button"
                onClick={() => setShelfDialog({})}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-stone-900 px-4 text-sm font-medium text-stone-50 transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200 cursor-pointer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{_('library.newShelf')}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </header>
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event: DragStartEvent) => setActiveDragId(String(event.active.id))}
      onDragCancel={() => setActiveDragId(null)}
      onDragEnd={(event) => void handleDragEnd(event)}
    >
      {query.isLoading ? (
        <div aria-busy="true" className="h-16 animate-pulse rounded-lg bg-stone-200/60 dark:bg-stone-800" />
      ) : query.isError ? (
        <QueryErrorState isRetrying={query.isFetching} onRetry={() => void query.refetch()} />
      ) : panel === 'tags' ? (
        showEmptyState ? (
          <TaxonomyEmptyState type="tags" />
        ) : (
          <SortableContext items={tags.map((row) => `directory:${row.id}`)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {tags.filter((tag) => matches(tag.name)).map((tag) => entry(tag, true))}
            </div>
          </SortableContext>
        )
      ) : panel === 'categories' ? (
        showEmptyState ? (
          <TaxonomyEmptyState type="categories" />
        ) : (
          <SortableContext items={categories.filter((row) => !row.parentId).map((row) => `directory:${row.id}`)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-2 2xl:grid-cols-3">
              {categories.filter((category) => !category.parentId).map((root) => {
                const children = categories.filter((category) => category.parentId === root.id && (matches(category.name) || matches(root.name)))
                if (!matches(root.name) && children.length === 0) return null
                return (
                  <RootCategorySection
                    key={root.id}
                    root={root}
                    subcategories={children}
                    entry={entry}
                    isDraggingSubcategory={isDraggingSubcategory}
                    draggedParentId={draggedCategory?.parentId ?? null}
                  />
                )
              })}
              {isDraggingSubcategory && <PromoteCardDropZone />}
            </div>
          </SortableContext>
        )
      ) : showEmptyState ? (
        <TaxonomyEmptyState type="shelves" />
      ) : (
        <SortableContext items={shelves.map((row) => `directory:${row.id}`)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {shelves.filter((shelf) => matches(shelf.name)).map((shelf) => entry(shelf))}
          </div>
        </SortableContext>
      )}
      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease-out' }}>
        {draggedItem ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-stone-200/90 bg-white px-3 py-2 text-stone-900 shadow-xl ring-2 ring-stone-900/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50 min-h-10 select-none pointer-events-none">
            <span className="flex min-w-0 items-center gap-2">
              {panel === 'tags' ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                  <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42z" /><circle cx="7" cy="7" r="1" />
                </svg>
              ) : (
                <TaxonomyIcon kind={panel === 'categories' ? 'category' : 'shelf'} size={15} className="shrink-0 text-stone-400" />
              )}
              <span className="truncate font-medium text-[13px]">{draggedItem.name}</span>
            </span>
            <span className="rounded-full bg-stone-200/50 px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums text-stone-500 dark:bg-stone-900/70 dark:text-stone-400">
              {draggedItem.bookCount}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
    {selecting && <TaxonomySelectionBar rows={selectedRows} pending={batchPending} canManage={canManage && !query.isError && !query.isLoading}
      clearValues={panel !== 'shelves'}
      canSelectAll={matchingRows.some((row) => !selection.has(row.id))}
      onSelectAll={() => { if (!batchLock.current) setSelection((current) => new Set([...current, ...matchingRows.map((row) => row.id)])) }}
      onClear={() => { if (!batchLock.current) { setSelection(new Set()); setSelecting(false) } }}
      onAction={(action) => { if (action === 'delete') setBatchDeleting(true); else void applyBatch(action) }} />}
    {batchDeleting && <ConfirmDialog title={_(panel === 'shelves' ? 'library.delete' : 'library.clear')}
      message={_(panel === 'tags' ? 'library.taxonomyBatchClearTags' : panel === 'categories' ? 'library.taxonomyBatchClearCategories' : 'library.taxonomyBatchDeleteShelves', { count: selectedRows.length })}
      confirmLabel={_(panel === 'shelves' ? 'library.delete' : 'library.clear')} confirmDisabled={batchPending}
      onClose={() => { if (!batchLock.current) setBatchDeleting(false) }} onConfirm={() => applyBatch('delete')} />}
    <ShelfDialog open={shelfDialog !== null} shelfId={shelfDialog?.id} initialName={shelfDialog?.name} onClose={() => setShelfDialog(null)} />
    <TagDialog open={tagDialog !== null} libraryId={libraryId ?? undefined} source={source} tagId={tagDialog?.id} initialName={tagDialog?.name} onClose={() => setTagDialog(null)} />
    <CategoryValueDialog open={categoryDialog !== null} libraryId={categoryLibraryId} source={source} categories={categories} path={categoryDialog?.path} initialName={categoryDialog?.name} onClose={() => setCategoryDialog(null)} />
    {deleting && <ConfirmDialog title={_(deleting.tag ? 'library.clearTag' : panel === 'categories' ? 'library.clearCategory' : 'library.deleteShelf')}
      message={_(deleting.tag ? 'library.clearTagConfirm' : panel === 'categories' ? 'library.clearCategoryConfirm' : 'library.deleteShelfConfirm', { name: deleting.name })}
      confirmLabel={_(deleting.tag || panel === 'categories' ? 'library.clear' : 'reader.delete')} confirmDisabled={deletingPending} onClose={() => { if (!deletingPending) setDeleting(null) }} onConfirm={() => {
        if (deletingPending) return
        setDeletingPending(true)
        const category = categories.find((item) => item.id === deleting.id)
        const operation = panel === 'categories' ? clearCategory.mutateAsync({ libraryId: categoryLibraryId, path: category?.path ?? JSON.parse(deleting.id), source }) : deleting.tag ? clearTag.mutateAsync({ libraryId, name: deleting.name, source }) : deleteShelf.mutateAsync(deleting.id)
        void operation.then(() => setDeleting(null)).catch(() => undefined).finally(() => setDeletingPending(false))
      }} />}
  </section>
}
