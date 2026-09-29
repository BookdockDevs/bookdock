import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { BatchSelectionItem, ReadStatus } from '@bookdock/shared'
import { apiDelete, apiPatch, apiPost } from '@/api/client'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import { useLibraryCategories, useLibraryTags, useShelves, useTags } from '../hooks'

interface SelectionBarProps {
  selectedIds: string[]
  onClear: () => void
  onComplete?: () => void
  onRetainSelection?: (ids: string[]) => void
  trash?: boolean
  trashEnabled?: boolean
  elevated?: boolean
  libraryId?: string
}

const BATCH_STATUS_ACTIONS: { value: ReadStatus; labelKey: string }[] = [
  { value: 'wishlist', labelKey: 'library.markWishlist' },
  { value: 'reading', labelKey: 'library.markReading' },
  { value: 'finished', labelKey: 'library.markFinished' },
  { value: 'idle', labelKey: 'library.markIdle' },
  { value: 'abandoned', labelKey: 'library.markAbandoned' },
]

async function settleBatch(ids: string[], action: (id: string) => Promise<unknown>) {
  const results: PromiseSettledResult<unknown>[] = new Array(ids.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
    while (cursor < ids.length) {
      const index = cursor++
      try {
        results[index] = { status: 'fulfilled', value: await action(ids[index]) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }))
  return results
}

export default function SelectionBar({ selectedIds, onClear, onComplete = onClear, onRetainSelection, trash = false, trashEnabled = true, elevated = false, libraryId }: SelectionBarProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  // Trash is a private-library state. The caller already forces it off in a
  // shared library, but a stale prop must never flip this bar into offering
  // restore/permanent-delete for work ids against private endpoints.
  const effectiveTrash = trash && !libraryId
  const [dialog, setDialog] = useState<'organize' | 'delete' | 'permanent' | null>(null)
  const [menu, setMenu] = useState<'status' | 'more' | null>(null)
  const [marking, setMarking] = useState(false)
  const selectionQuery = useQuery({
    queryKey: ['batch-selection', libraryId ?? 'private', [...selectedIds].sort().join('|')],
    queryFn: () => apiPost<{ data: BatchSelectionItem[] }>(
      libraryId ? `/libraries/${libraryId}/books/batch/selection` : '/books/batch/selection',
      { ids: selectedIds },
    ),
    enabled: !effectiveTrash && selectedIds.length > 0,
  })
  const selectionItems = selectionQuery.data?.data ?? []
  const selectionReady = effectiveTrash || (selectionQuery.isSuccess && selectionItems.length === selectedIds.length)
  const allPinned = selectionReady && selectionItems.every((item) => Boolean(item.pinnedAt))
  const allHidden = selectionReady && selectionItems.every((item) => item.hidden)
  const barRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setCanScrollLeft(scrollLeft > 2)
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 2)
  }, [])

  useEffect(() => {
    updateScrollState()
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateScrollState, selectedIds.length, effectiveTrash])

  useEffect(() => {
    if (!menu) return
    const onPointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      setMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [menu])

  async function runBatch(
    action: (bookId: string) => Promise<unknown>,
    successKey: string,
    actionKey: string,
    ids = selectedIds,
  ) {
    setMarking(true)
    const results = await settleBatch(ids, action)
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    if (libraryId) {
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'tags'] })
    }
    if (failed === 0) {
      notify.success({ key: successKey, params: { count: succeeded } })
    } else {
      const failedIds = ids.filter((_, index) => results[index]?.status === 'rejected')
      onRetainSelection?.(failedIds)
      notify.warning(
        { key: 'library.batchPartial', params: { action: _(actionKey), succeeded, failed } },
        {
          duration: 'persistent',
          action: {
            label: _('library.batchRetryFailed'),
            onClick: () => {
              void runBatch(action, successKey, actionKey, failedIds).then((ok) => {
                if (ok) onComplete()
              })
            },
          },
        },
      )
    }
    setMarking(false)
    return failed === 0
  }

  async function handleBatchStatus(value: ReadStatus) {
    const ok = await runBatch(
      (bookId) => apiPatch(`/books/${bookId}`, { readStatus: value }),
      'library.batchStatusSucceeded',
      'library.batchActionStatus',
    )
    if (ok) onComplete()
  }

  async function handleBatchRestore() {
    const ok = await runBatch(
      (bookId) => apiPost(`/books/${bookId}/restore`),
      'library.batchRestoreSucceeded',
      'library.batchActionRestore',
    )
    if (ok) onComplete()
  }

  async function handleBatchHide(hidden: boolean) {
    // Private ids are version ids, shared-library ids are work ids; each
    // endpoint hides the caller's own row without touching anything else.
    const ok = await runBatch(
      (id) => libraryId
        ? apiPatch(`/libraries/${libraryId}/books/${id}`, { hidden })
        : apiPatch(`/books/${id}`, { hidden }),
      'library.batchHideSucceeded',
      'library.batchActionHide',
    )
    if (libraryId) {
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'tags'] })
    }
    if (ok) onComplete()
  }

  async function handleBatchPin(pinned: boolean) {
    const ok = await runBatch(
      (id) => libraryId
        ? apiPatch(`/libraries/${libraryId}/books/${id}`, { pinned })
        : apiPatch(`/books/${id}`, { pinned }),
      'library.batchSucceeded',
      pinned ? 'library.pin' : 'library.unpin',
    )
    if (ok) onComplete()
  }

  return (
    <>
      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 z-40 flex justify-center transition-[bottom] duration-200 select-none md:left-60',
          elevated
            ? 'bottom-[calc(3.85rem+env(safe-area-inset-bottom))] sm:bottom-[4.25rem]'
            : 'bottom-[calc(0.75rem+env(safe-area-inset-bottom))] sm:bottom-5',
        )}
      >
        <div ref={barRef} className="pointer-events-auto relative flex w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] items-center rounded-2xl border border-stone-200/80 bg-white/95 shadow-xl shadow-stone-900/8 backdrop-blur-md animate-selection-bar-in sm:w-auto sm:max-w-none dark:border-stone-700 dark:bg-stone-900/95">
          {/* Left fade shadow */}
          <div
            data-testid="selection-bar-fade-left"
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 z-10 w-6 rounded-l-2xl bg-gradient-to-r from-white via-white/80 to-transparent transition-opacity duration-200 dark:from-stone-900 dark:via-stone-900/80',
              canScrollLeft ? 'opacity-100' : 'opacity-0',
            )}
          />
          {/* Right fade shadow */}
          <div
            data-testid="selection-bar-fade-right"
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 right-0 z-10 w-6 rounded-r-2xl bg-gradient-to-l from-white via-white/80 to-transparent transition-opacity duration-200 dark:from-stone-900 dark:via-stone-900/80',
              canScrollRight ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div
            ref={scrollerRef}
            onScroll={updateScrollState}
            className="flex w-full items-center gap-2 overflow-x-auto py-2 pl-4 pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto"
          >
            <span className="mr-1 whitespace-nowrap text-xs font-medium text-stone-600 dark:text-stone-300">
              {_('library.selectionCount', { count: selectedIds.length })}
            </span>
          {effectiveTrash ? (
            <>
              <Button className="shrink-0 whitespace-nowrap" variant="secondary" size="sm" disabled={marking} onClick={() => void handleBatchRestore()}>
                {_('library.restore')}
              </Button>
              <Button className="shrink-0 whitespace-nowrap" variant="danger" size="sm" disabled={marking} onClick={() => setDialog('permanent')}>
                {_('library.permanentDelete')}
              </Button>
            </>
          ) : (
            <>
              <Button className="shrink-0 whitespace-nowrap" variant="secondary" size="sm" disabled={marking || !selectionReady} onClick={() => setDialog('organize')}>
                {_('library.batchOrganize')}
              </Button>
              {!libraryId && <Button className="hidden shrink-0 whitespace-nowrap md:inline-flex" variant="ghost" size="sm" disabled={marking} onClick={() => setMenu(menu === 'status' ? null : 'status')}>
                {_('library.readStatusLabel')}
              </Button>}
              <Button className="hidden shrink-0 whitespace-nowrap md:inline-flex" variant="ghost" size="sm" disabled={marking || !selectionReady} onClick={() => void handleBatchPin(!allPinned)}>
                {_(allPinned ? 'library.unpin' : 'library.pin')}
              </Button>
              <Button className="shrink-0 whitespace-nowrap" variant="ghost" size="sm" disabled={marking || !selectionReady} onClick={() => setMenu(menu === 'more' ? null : 'more')}>
                {_('library.moreActions')}
              </Button>
            </>
          )}
          <button
            type="button"
            onClick={onClear}
            aria-label={_('library.clearSelection')}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          </div>
          {selectionQuery.isError && !effectiveTrash && (
            <div role="alert" className="absolute bottom-full left-2 mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 shadow dark:bg-red-950 dark:text-red-200">
              <span>{_('library.batchSelectionFailed')}</span>
              <button type="button" onClick={() => void selectionQuery.refetch()} className="underline">{_('library.batchSelectionRetry')}</button>
            </div>
          )}
          {menu && !effectiveTrash && (
            <div className="absolute bottom-full right-2 mb-2 min-w-36 rounded-xl border border-stone-200 bg-white p-1 shadow-xl dark:border-stone-700 dark:bg-stone-900">
              {menu === 'status' ? BATCH_STATUS_ACTIONS.map((action) => (
                <button key={action.value} type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800" onClick={() => { setMenu(null); void handleBatchStatus(action.value) }}>
                  {_(action.labelKey)}
                </button>
              )) : (
                <>
                  {!libraryId && <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 md:hidden dark:hover:bg-stone-800" onClick={() => setMenu('status')}>{_('library.readStatusLabel')}</button>}
                  <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 md:hidden dark:hover:bg-stone-800" onClick={() => { setMenu(null); void handleBatchPin(!allPinned) }}>{_(allPinned ? 'library.unpin' : 'library.pin')}</button>
                  <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800" onClick={() => { setMenu(null); void handleBatchHide(!allHidden) }}>{_(allHidden ? 'library.show' : 'library.hide')}</button>
                  <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={() => { setMenu(null); setDialog('delete') }}>{_('library.batchDelete')}</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {dialog === 'organize' && (
        <BatchClassifyDialog
          ids={selectedIds}
          items={selectionItems}
          libraryId={libraryId}
          onClose={() => setDialog(null)}
          onDone={onComplete}
        />
      )}

      {dialog === 'delete' && (
        <BatchDeleteDialog
          ids={selectedIds}
          items={selectionItems}
          libraryId={libraryId}
          trashEnabled={trashEnabled}
          onRetainSelection={onRetainSelection}
          onClose={() => setDialog(null)}
          onDone={onComplete}
        />
      )}

      {dialog === 'permanent' && (
        <BatchPermanentDeleteDialog
          ids={selectedIds}
          onRetainSelection={onRetainSelection}
          onClose={() => setDialog(null)}
          onDone={onComplete}
        />
      )}
    </>
  )
}

function BatchClassifyDialog({ ids, items, libraryId, onClose, onDone }: { ids: string[]; items: BatchSelectionItem[]; libraryId?: string; onClose: () => void; onDone: () => void }) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const { data: shelvesData } = useShelves()
  const { data: tagsData } = useTags()
  const { data: libraryCategories } = useLibraryCategories(libraryId ?? null)
  const { data: libraryTags } = useLibraryTags(libraryId ?? null)
  const [activeTab, setActiveTab] = useState<'shelves' | 'tags'>('shelves')
  // undefined = untouched (no shelf PUT), null = move out of shelf (uncategorized)
  const [selectedShelf, setSelectedShelf] = useState<string | null | undefined>(undefined)
  const [tagChanges, setTagChanges] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  const shelves = libraryId ? (libraryCategories?.data ?? []) : (shelvesData?.data ?? [])
  const tags = libraryId ? (libraryTags?.data ?? []) : (tagsData?.data ?? [])
  const initialCategory = items.every((item) => item.categoryId === items[0]?.categoryId) ? items[0]?.categoryId : undefined

  async function handleApply() {
    setSaving(true)
    try {
      await apiPatch(libraryId ? `/libraries/${libraryId}/books/batch/organize` : '/books/batch/organize', {
        ids,
        ...(selectedShelf !== undefined ? { categoryId: selectedShelf } : {}),
        addTagIds: Object.keys(tagChanges).filter((id) => tagChanges[id]),
        removeTagIds: Object.keys(tagChanges).filter((id) => !tagChanges[id]),
      })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['shelves'] })
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
      if (libraryId) {
        void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'catalog'] })
        void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'categories'] })
        void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'tags'] })
      }
      notify.success({ key: 'library.batchClassifySucceeded', params: { count: ids.length } })
      onDone()
      onClose()
    } catch {
      notify.error(_('library.batchOrganizeFailed'))
      setSaving(false)
    }
  }

  const showSave = selectedShelf !== undefined || Object.keys(tagChanges).length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-4">
      <div className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] rounded-t-xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-none sm:overflow-visible sm:rounded-xl dark:bg-stone-900">
        <h2 className="mb-4 font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
          {_('library.batchOrganize')}
        </h2>
        <p className="mb-4 text-sm text-stone-500">
          {_('library.batchOrganizeConfirm', { count: ids.length })}
        </p>

        <div className="mb-4 flex rounded-lg border border-stone-200 p-0.5 dark:border-stone-800">
          <button
            type="button"
            onClick={() => setActiveTab('shelves')}
            className={cn(
              'flex-1 rounded-md py-1.5 text-sm transition-colors',
              activeTab === 'shelves'
                ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200',
            )}
          >
            {_(libraryId ? 'library.categories' : 'library.shelves')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tags')}
            className={cn(
              'flex-1 rounded-md py-1.5 text-sm transition-colors',
              activeTab === 'tags'
                ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200',
            )}
          >
            {_('library.tags')}
          </button>
        </div>

        {activeTab === 'shelves' ? (
          <div className="flex max-h-60 flex-col gap-1 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1">
            <ShelfRadio
              label={_('library.uncategorized')}
              checked={selectedShelf === null || (selectedShelf === undefined && initialCategory === null)}
              onChange={() => setSelectedShelf(null)}
            />
            {shelves.map((shelf) => (
              <ShelfRadio
                key={shelf.id}
                label={shelf.name}
                count={shelf.bookCount}
                checked={selectedShelf === shelf.id || (selectedShelf === undefined && initialCategory === shelf.id)}
                onChange={() => setSelectedShelf(shelf.id)}
              />
            ))}
          </div>
        ) : tags.length === 0 ? (
          <div className="py-4 text-center text-sm text-stone-400">{_('library.noTags')}</div>
        ) : (
          <div className="flex max-h-60 flex-col gap-1 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1">
            {tags.map((tag) => {
              const count = items.filter((item) => item.tagIds.includes(tag.id)).length
              const state = tagChanges[tag.id] === undefined ? (count === 0 ? 'none' : count === ids.length ? 'all' : 'mixed') : (tagChanges[tag.id] ? 'all' : 'none')
              return (
              <label
                key={tag.id}
                className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-800"
              >
                <span className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-200">
                  <input
                    type="checkbox"
                    checked={state === 'all'}
                    ref={(node) => { if (node) node.indeterminate = state === 'mixed' }}
                    onChange={() => setTagChanges((previous) => ({ ...previous, [tag.id]: state !== 'all' }))}
                    className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-500 dark:border-stone-700"
                  />
                  <span className="truncate">{tag.name}</span>
                </span>
                <span className="text-xs text-stone-400">{state === 'all' ? ids.length : state === 'none' ? 0 : count}/{ids.length}</span>
              </label>
            )})}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{_('library.cancel')}</Button>
          <Button disabled={!showSave || saving} onClick={() => void handleApply()}>{_('library.save')}</Button>
        </div>
      </div>
    </div>
  )
}

function ShelfRadio({ label, count, checked, onChange }: { label: string; count?: number; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-800">
      <span className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-200">
        <input
          type="radio"
          checked={checked}
          onChange={onChange}
          className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-500 dark:border-stone-700"
        />
        <span className="truncate">{label}</span>
      </span>
      {count !== undefined && <span className="text-xs text-stone-400">{count}</span>}
    </label>
  )
}

function BatchDeleteDialog({ ids, items, libraryId, trashEnabled, onRetainSelection, onClose, onDone }: {
  ids: string[]
  items: BatchSelectionItem[]
  libraryId?: string
  trashEnabled: boolean
  onRetainSelection?: (ids: string[]) => void
  onClose: () => void
  onDone: () => void
}) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const [deleteUserData, setDeleteUserData] = useState(false)
  const collectedCount = items.filter((item) => item.kind === 'shared').length
  const ownedCount = libraryId ? 0 : items.length - collectedCount
  const versionCount = items.reduce((total, item) => total + item.versionCount, 0)

  async function handleDelete() {
    setDeleting(true)
    const byId = new Map(items.map((item) => [item.id, item]))
    const results = await settleBatch(ids, (id) => libraryId
      ? apiDelete(`/libraries/${libraryId}/books/${id}`)
      : apiDelete(`/books/${id}${byId.get(id)?.kind === 'shared' && deleteUserData ? '?deleteUserData=true' : ''}`))
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    void queryClient.invalidateQueries({ queryKey: ['shelves'] })
    void queryClient.invalidateQueries({ queryKey: ['tags'] })
    if (libraryId) {
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'tags'] })
    }
    if (failed === 0) {
      notify.success({ key: 'library.batchDeleteSucceeded', params: { count: succeeded } })
    } else {
      notify.warning({
        key: 'library.batchPartial',
        params: { action: _('library.batchActionDelete'), succeeded, failed },
      })
      onRetainSelection?.(ids.filter((_, index) => results[index]?.status === 'rejected'))
    }
    if (failed === 0) {
      onDone()
      onClose()
    } else {
      onClose()
    }
  }

  return (
    <ConfirmDialog
      title={_('library.batchDelete')}
      message={
        <div className="space-y-2">
          {libraryId ? (
            <p>{_('library.batchDeleteSharedConfirm', { count: ids.length, versions: versionCount })}</p>
          ) : (
            <>
              {ownedCount > 0 && <p>{_(trashEnabled ? 'library.batchDeleteOwnedTrash' : 'library.batchDeleteOwnedPermanent', { count: ownedCount })}</p>}
              {collectedCount > 0 && <p>{_('library.batchDeleteCollected', { count: collectedCount })}</p>}
              {collectedCount > 0 && (
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={deleteUserData} onChange={(event) => setDeleteUserData(event.target.checked)} />
                  {_('library.clearUserDataOnRemove')}
                </label>
              )}
            </>
          )}
        </div>
      }
      confirmLabel={_('library.batchDelete')}
      confirmVariant="danger"
      confirmDisabled={deleting}
      onClose={onClose}
      onConfirm={() => void handleDelete()}
    />
  )
}

function BatchPermanentDeleteDialog({ ids, onRetainSelection, onClose, onDone }: { ids: string[]; onRetainSelection?: (ids: string[]) => void; onClose: () => void; onDone: () => void }) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    const results = await settleBatch(ids, (id) => apiDelete(`/books/${id}/permanent`))
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    if (failed === 0) {
      notify.success({ key: 'library.batchPermanentDeleteSucceeded', params: { count: succeeded } })
    } else {
      notify.warning({
        key: 'library.batchPartial',
        params: { action: _('library.batchActionPermanentDelete'), succeeded, failed },
      })
    }
    if (failed === 0) {
      onDone()
      onClose()
    } else {
      onRetainSelection?.(ids.filter((_, index) => results[index]?.status === 'rejected'))
      onClose()
    }
  }

  return (
    <ConfirmDialog
      title={_('library.permanentDelete')}
      message={_('library.batchPermanentDeleteConfirm', { count: ids.length })}
      confirmLabel={_('library.permanentDelete')}
      confirmVariant="danger"
      confirmDisabled={deleting}
      onClose={onClose}
      onConfirm={() => void handleDelete()}
    />
  )
}
