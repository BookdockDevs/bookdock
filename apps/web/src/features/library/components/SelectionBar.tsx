import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ClientBatchSelectionItem, ReadStatus, UndoReceipt } from '@bookdock/shared'
import { apiDelete, apiPatch, apiPost } from '@/api/client'
import { READING_RECORDS_KEY } from '@/api/hooks/reading-records'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { publishUndoOpportunity } from '@/lib/undo'
import { cn } from '@/lib/utils'
import { useDownloadStore } from '@/stores/download.store'
import { catalogQueryKey } from '@/features/reading-data/catalog'
import { useLocalCatalog } from '@/features/reading-data/catalog-source-context'
import { DEVICE_VAULT_SCOPE } from '@/features/local-library/catalog'
import { isDeviceBook, partitionByStore } from '@/features/reading-data/book-source'
import { catalogSelectionId, catalogSelectionKey, catalogSelectionScope, splitCatalogSelectionKeys } from '@/features/reading-data/catalog-selection'
import { localRecordId } from '@/features/local-library/id'

import { invalidateDeviceMembershipQueries, invalidatePermanentlyDeletedBookQueries, useLibraryCategories, useLibraryTags, useShelves, useTags, useVaultOperations } from '../hooks'
import { categoryChoices } from '../taxonomy'
import CategoryAssignmentSelector from './CategoryAssignmentSelector'
import ClearBookDataOption from './ClearBookDataOption'
import TaxonomyChoiceRow from './TaxonomyChoiceRow'
import { READ_STATUS_OPTIONS } from './read-status'

interface SelectionBarProps {
  /** Scope-qualified selection keys (`local:<id>` / `server:<id>`). */
  selectedKeys: string[]
  onClear: () => void
  onComplete?: () => void
  onRetainSelection?: (ids: string[]) => void
  trash?: boolean
  trashEnabled?: boolean
  elevated?: boolean
  libraryId?: string
  taxonomyLibraryId?: string
}

const BATCH_STATUS_ACTIONS: { value: ReadStatus; labelKey: string }[] = [
  { value: 'wishlist', labelKey: 'library.markWishlist' },
  { value: 'reading', labelKey: 'library.markReading' },
  { value: 'finished', labelKey: 'library.markFinished' },
  { value: 'idle', labelKey: 'library.markIdle' },
  { value: 'abandoned', labelKey: 'library.markAbandoned' },
]

async function settleBatch<T>(items: T[], action: (item: T) => Promise<unknown>) {
  const results: PromiseSettledResult<unknown>[] = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = { status: 'fulfilled', value: await action(items[index]) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }))
  return results
}

export default function SelectionBar({ selectedKeys, onClear, onComplete = onClear, onRetainSelection, trash = false, trashEnabled = true, elevated = false, libraryId, taxonomyLibraryId }: SelectionBarProps) {
  const _ = useTranslation()
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const queryClient = useQueryClient()
  // Selection keys carry the scope; mixed selections dispatch each key to its
  // own source. `viewIds` counts the raw ids behind the keys.
  const { localIds, serverIds } = splitCatalogSelectionKeys(selectedKeys)
  const viewIds = [...localIds, ...serverIds]
  // Trash mode offers only restore/permanent-delete, which route per id below
  // (private endpoints for private ids, library endpoints for work ids), so a
  // shared-library trash selection is safe here. Normal mode keeps the
  // selection query to resolve organize/pin/hide/delete metadata.
  const effectiveTrash = trash
  const sharedTrash = trash && Boolean(libraryId)
  const [dialog, setDialog] = useState<'organize' | 'delete' | 'permanent' | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [marking, setMarking] = useState(false)
  // The cache marker names the authorities the selection spans; a mixed
  // selection must not reuse the device-only entry.
  const selectionStore = localIds.length === 0 ? 'private' : serverIds.length === 0 ? 'device' : 'mixed'
  const selectionQuery = useQuery({
    networkMode: 'always',
    queryKey: ['batch-selection', libraryId ?? selectionStore, [...selectedKeys].sort().join('|')],
    queryFn: async () => {
      const [localItems, serverItems] = await Promise.all([
        localIds.length ? vault.selection(localIds) : Promise.resolve([] as ClientBatchSelectionItem[]),
        serverIds.length ? apiPost<{ data: ClientBatchSelectionItem[] }>(
          libraryId ? `/libraries/${libraryId}/books/batch/selection` : '/books/batch/selection',
          { ids: serverIds },
        ).then((res) => res.data) : Promise.resolve([] as ClientBatchSelectionItem[]),
      ])
      return { data: [...localItems, ...serverItems] }
    },
    enabled: Boolean(localIds.length || !effectiveTrash) && selectedKeys.length > 0,
  })
  const selectionItems = selectionQuery.data?.data ?? []
  const selectionReady = effectiveTrash && !localIds.length || (selectionQuery.isSuccess && selectionItems.length === viewIds.length)
  const allPinned = selectionReady && selectionItems.every((item) => Boolean(item.pinnedAt))
  const allHidden = selectionReady && selectionItems.every((item) => item.hidden)
  const barRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const statusButtonRef = useRef<HTMLButtonElement>(null)
  const [statusAnchorLeft, setStatusAnchorLeft] = useState<number | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateStatusAnchor = useCallback(() => {
    const btn = statusButtonRef.current
    const bar = barRef.current
    if (btn && bar) {
      const btnRect = btn.getBoundingClientRect()
      const barRect = bar.getBoundingClientRect()
      setStatusAnchorLeft(btnRect.left - barRect.left + btnRect.width / 2)
    }
  }, [])

  const toggleStatusMenu = useCallback(() => {
    if (statusOpen) {
      setStatusOpen(false)
      setStatusAnchorLeft(null)
    } else {
      updateStatusAnchor()
      setStatusOpen(true)
    }
  }, [statusOpen, updateStatusAnchor])

  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setCanScrollLeft(scrollLeft > 2)
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 2)
    if (statusOpen) {
      updateStatusAnchor()
    }
  }, [statusOpen, updateStatusAnchor])

  useEffect(() => {
    updateScrollState()
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateScrollState, viewIds.length, effectiveTrash])

  useEffect(() => {
    if (!statusOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) {
        setStatusOpen(false)
        setStatusAnchorLeft(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      setStatusOpen(false)
      setStatusAnchorLeft(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [statusOpen])

  async function runBatch(
    action: (key: string) => Promise<unknown>,
    successKey: string,
    actionKey: string,
    keys = selectedKeys,
  ) {
    setMarking(true)
    const results = await settleBatch(keys, action)
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    if (keys.some((key) => catalogSelectionScope(key) === 'local')) {
      void queryClient.invalidateQueries({ queryKey: catalogQueryKey(DEVICE_VAULT_SCOPE, 'list').slice(0, -1) })
      if (!local) {
        invalidateDeviceMembershipQueries(queryClient)
        void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      }
    }
    if (keys.some((key) => catalogSelectionScope(key) === 'server')) void queryClient.invalidateQueries({ queryKey: ['books'] })
    if (libraryId && keys.some((key) => catalogSelectionScope(key) === 'server')) {
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'tags'] })
    }
    if (failed === 0) {
      notify.success({ key: successKey, params: { count: succeeded } })
    } else {
      const failedKeys = keys.filter((_, index) => results[index]?.status === 'rejected')
      onRetainSelection?.(failedKeys)
      const showResult = succeeded > 0 ? notify.warning : notify.error
      showResult(
        { key: succeeded > 0 ? 'library.batchPartial' : 'library.batchFailed', params: { action: _(actionKey), succeeded, failed } },
        {
          duration: 'persistent',
          action: {
            label: _('library.batchRetryFailed'),
            onClick: () => {
              void runBatch(action, successKey, actionKey, failedKeys).then((ok) => {
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

  async function runPrivateBatchUpdate(
    update: { hidden?: boolean; pinned?: boolean },
    successKey: string,
    actionKey: string,
    keys = selectedKeys,
    retryDedupeKey = `private-batch-update:${actionKey}:${[...keys].sort().join(':')}`,
  ): Promise<boolean> {
    setMarking(true)
    try {
      const selected = selectionItems.filter((item) => keys.includes(catalogSelectionKey(item)))
      if (selected.length !== keys.length) throw new Error('The selected books changed')
      const { device: localSelected, server: serverItems } = partitionByStore(selected, (item) => item.ref)
      const serverIds = serverItems.map((item) => item.id)
      let succeeded = 0
      const failedKeys: string[] = []
      let undo: UndoReceipt | undefined
      if (localSelected.length) {
        await vault.updateSelection(localSelected, update)
        succeeded += localSelected.length
      }
      if (serverIds.length) {
        const result = await apiPatch<{ data: { succeeded: number; failed: number; failedIds: string[] }; undo?: UndoReceipt }>('/books/batch/update', { ids: serverIds, ...update })
        succeeded += result.data.succeeded
        for (const failedId of result.data.failedIds) failedKeys.push(`server:${failedId}`)
        undo = result.undo
      }
      if (localSelected.length) {
        void queryClient.invalidateQueries({ queryKey: catalogQueryKey(DEVICE_VAULT_SCOPE, 'list').slice(0, -1) })
        if (!local) {
          invalidateDeviceMembershipQueries(queryClient)
          void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
        }
      }
      if (serverIds.length) {
        void queryClient.invalidateQueries({ queryKey: ['books'] })
        void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      }
      const failed = failedKeys.length
      const batchUndo = localSelected.length && serverIds.length ? undefined : undo
      if (failed > 0) {
        onRetainSelection?.(failedKeys)
        notify.warning(
          { key: succeeded > 0 ? 'library.batchPartial' : 'library.batchFailed', params: { action: _(actionKey), succeeded, failed } },
          { duration: 'persistent', dedupeKey: retryDedupeKey, undo: batchUndo, action: { label: _('library.batchRetryFailed'), onClick: () => { void runPrivateBatchUpdate(update, successKey, actionKey, failedKeys, retryDedupeKey).then((ok) => { if (ok) onComplete() }) } } },
        )
      } else {
        notify.success({ key: successKey, params: { count: succeeded } }, { dedupeKey: retryDedupeKey, undo: batchUndo })
        onComplete()
      }
      return failed === 0
    } catch {
      notify.error({ key: 'library.batchFailed', params: { action: _(actionKey), failed: keys.length } })
      onRetainSelection?.(keys)
      return false
    } finally {
      setMarking(false)
    }
  }

  async function handleBatchStatus(value: ReadStatus) {
    const ok = await runBatch(
      (key) => {
        const bookId = catalogSelectionId(key)
        return catalogSelectionScope(key) === 'local'
          ? vault.setReadStatus({ scope: DEVICE_VAULT_SCOPE, bookId }, value)
          : apiPatch(`/books/${bookId}`, { readStatus: value })
      },
      'library.batchStatusSucceeded',
      'library.batchActionStatus',
    )
    if (ok) onComplete()
  }

  async function handleBatchRestore() {
    const ok = await runBatch(
      (key) => {
        const bookId = catalogSelectionId(key)
        if (catalogSelectionScope(key) === 'local') {
          return vault.restore({ scope: DEVICE_VAULT_SCOPE, bookId }, selectionItems.find((item) => isDeviceBook(item.ref) && item.id === bookId)?.clientVersion)
        }
        return libraryId
          ? apiPost(`/libraries/${libraryId}/books/${bookId}/restore`, {})
          : apiPost(`/books/${bookId}/restore`)
      },
      'library.batchRestoreSucceeded',
      'library.batchActionRestore',
    )
    if (selectedKeys.some((key) => catalogSelectionScope(key) === 'server')) void invalidatePermanentlyDeletedBookQueries(queryClient)
    if (ok) onComplete()
  }

  async function handleBatchHide(hidden: boolean) {
    if (!libraryId) {
      await runPrivateBatchUpdate({ hidden }, 'library.batchHideSucceeded', 'library.batchActionHide')
      return
    }
    // Shared-library ids identify works; the manager endpoint mutates the
    // library-owned row without touching its versions.
    const ok = await runBatch(
      (key) => {
        const id = catalogSelectionId(key)
        return libraryId
          ? apiPatch(`/libraries/${libraryId}/books/${id}`, { hidden })
          : apiPatch(`/books/${id}`, { hidden })
      },
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
    if (!libraryId) {
      await runPrivateBatchUpdate({ pinned }, 'library.batchSucceeded', pinned ? 'library.pin' : 'library.unpin')
      return
    }
    const ok = await runBatch(
      (key) => {
        const id = catalogSelectionId(key)
        return libraryId
          ? apiPatch(`/libraries/${libraryId}/books/${id}`, { pinned })
          : apiPatch(`/books/${id}`, { pinned })
      },
      'library.batchSucceeded',
      pinned ? 'library.pin' : 'library.unpin',
    )
    if (ok) onComplete()
  }

  return (
    <>
      <div
        data-toast-obstacle=""
        className={cn(
          'pointer-events-none fixed inset-x-0 z-40 flex justify-center transition-[bottom] duration-200 select-none md:left-60',
          elevated
            ? 'bottom-[calc(3.85rem+env(safe-area-inset-bottom))] sm:bottom-[4.25rem]'
            : 'bottom-[calc(0.75rem+env(safe-area-inset-bottom))] sm:bottom-5',
        )}
      >
        <div ref={barRef} className="pointer-events-auto relative flex w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] items-center rounded-2xl border border-stone-200/90 bg-white/95 p-1 shadow-2xl shadow-stone-900/10 backdrop-blur-xl animate-selection-bar-in sm:w-auto sm:max-w-none dark:border-stone-700/80 dark:bg-stone-900/95">
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
            className="flex w-full items-center gap-1.5 overflow-x-auto py-1 pl-3 pr-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto"
          >
            <div className="flex shrink-0 items-center pl-1 pr-1.5 text-xs font-medium text-stone-600 select-none dark:text-stone-300">
              <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-800 dark:bg-stone-800 dark:text-stone-200">
                {_('library.selectionCount', { count: viewIds.length })}
              </span>
            </div>
            <div className="h-4 w-px shrink-0 bg-stone-200 dark:bg-stone-700" />
          {effectiveTrash ? (
            <>
              <Button className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5" variant="secondary" size="sm" disabled={marking || !selectionReady} onClick={() => void handleBatchRestore()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-400">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
                {_('library.restore')}
              </Button>
              <Button className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5" variant="danger" size="sm" disabled={marking || !selectionReady} onClick={() => setDialog('permanent')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                </svg>
                {_('library.permanentDelete')}
              </Button>
            </>
          ) : (
            <>
              <Button
                className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5"
                variant="ghost"
                size="sm"
                disabled={marking || !selectionReady}
                onClick={() => setDialog('organize')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-400">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                {_('library.batchOrganize')}
              </Button>
              <Button
                className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5"
                variant="ghost"
                size="sm"
                aria-label={_('library.download')}
                title={_('library.download')}
                disabled={marking || !selectionReady || selectionItems.some((item) => !item.bookVersionId && !isDeviceBook(item.ref))}
                onClick={() => useDownloadStore.getState().open(selectionItems.map((item) => ({
                  id: isDeviceBook(item.ref) ? item.id : item.bookVersionId!,
                  ref: item.ref,
                  bookVersionId: item.bookVersionId,
                  title: item.title,
                  format: item.format,
                })))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-400">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {_('library.download')}
              </Button>
              {!libraryId && (
                <Button
                  ref={statusButtonRef}
                  className={cn(
                    'shrink-0 whitespace-nowrap inline-flex items-center gap-1.5',
                    statusOpen && 'bg-stone-200/80 font-semibold text-stone-900 dark:bg-stone-700 dark:text-stone-100',
                  )}
                  variant="ghost"
                  size="sm"
                  disabled={marking}
                  onClick={toggleStatusMenu}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-400">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  {_('library.readStatusLabel')}
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('shrink-0 text-stone-400 transition-transform duration-150', statusOpen && 'rotate-180')}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </Button>
              )}
              <Button
                className={cn(
                  'shrink-0 whitespace-nowrap inline-flex items-center gap-1.5',
                  allPinned && 'bg-stone-200/80 font-semibold text-stone-900 dark:bg-stone-700 dark:text-stone-100',
                )}
                variant="ghost"
                size="sm"
                disabled={marking || !selectionReady}
                onClick={() => void handleBatchPin(!allPinned)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-400">
                  <path d="M12 17v5" />
                  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                </svg>
                {_(allPinned ? 'library.unpin' : 'library.pin')}
              </Button>
              <Button
                className={cn(
                  'shrink-0 whitespace-nowrap inline-flex items-center gap-1.5',
                  allHidden && 'bg-stone-200/80 font-semibold text-stone-900 dark:bg-stone-700 dark:text-stone-100',
                )}
                variant="ghost"
                size="sm"
                disabled={marking || !selectionReady}
                onClick={() => void handleBatchHide(!allHidden)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-400">
                  {allHidden ? (
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
                {_(allHidden ? 'library.show' : 'library.hide')}
              </Button>
              <Button
                className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                variant="ghost"
                size="sm"
                disabled={marking || !selectionReady}
                onClick={() => setDialog('delete')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-red-500/80 dark:text-red-400/80">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                </svg>
                {_('library.batchDelete')}
              </Button>
            </>
          )}
          <div className="h-4 w-px shrink-0 bg-stone-200 dark:bg-stone-700" />
          <button
            type="button"
            onClick={onClear}
            aria-label={_('library.clearSelection')}
            title={_('library.clearSelection')}
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
          {statusOpen && !effectiveTrash && (
            <div
              style={
                statusAnchorLeft !== null
                  ? { left: statusAnchorLeft, transform: 'translateX(-50%)' }
                  : { left: '50%', transform: 'translateX(-50%)' }
              }
              className="absolute bottom-full mb-2 min-w-40 rounded-xl border border-stone-200/90 bg-white/95 p-1.5 shadow-xl shadow-stone-900/10 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 dark:border-stone-700/90 dark:bg-stone-900/95 dark:shadow-black/40"
            >
              {BATCH_STATUS_ACTIONS.map((action) => {
                const opt = READ_STATUS_OPTIONS.find((o) => o.value === action.value)
                return (
                  <button
                    key={action.value}
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                    onClick={() => {
                      setStatusOpen(false)
                      setStatusAnchorLeft(null)
                      void handleBatchStatus(action.value)
                    }}
                  >
                    {opt && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${opt.iconClass}`}>
                        {opt.icon}
                      </svg>
                    )}
                    <span className="flex-1">{_(action.labelKey)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {dialog === 'organize' && (
        <BatchClassifyDialog
          ids={viewIds}
          items={selectionItems}
          libraryId={libraryId}
          taxonomyLibraryId={taxonomyLibraryId}
          onClose={() => setDialog(null)}
          onDone={onComplete}
        />
      )}

      {dialog === 'delete' && (
        <BatchDeleteDialog
          ids={viewIds}
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
          ids={viewIds}
          keys={selectedKeys}
          items={selectionItems}
          libraryId={sharedTrash ? libraryId : undefined}
          onRetainSelection={onRetainSelection}
          onClose={() => setDialog(null)}
          onDone={onComplete}
        />
      )}
    </>
  )
}

function BatchClassifyDialog({ ids, items, libraryId, taxonomyLibraryId, onClose, onDone }: { ids: string[]; items: ClientBatchSelectionItem[]; libraryId?: string; taxonomyLibraryId?: string; onClose: () => void; onDone: () => void }) {
  const _ = useTranslation()
  // A source context (the /local view) supplies its own vault operations;
  // the unified shelf has no context and binds the device vault directly.
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const queryClient = useQueryClient()
  const { data: shelvesData } = useShelves({ fallbackAnonymous: !libraryId })
  const { data: tagsData } = useTags({ fallbackAnonymous: !libraryId })
  const { data: libraryCategories } = useLibraryCategories(taxonomyLibraryId ?? libraryId ?? null)
  const { data: libraryTags } = useLibraryTags(libraryId ?? null)
  const [activeTab, setActiveTab] = useState<'shelves' | 'categories' | 'tags'>(libraryId ? 'categories' : 'shelves')
  // undefined = untouched (no shelf PUT), null = move out of shelf (uncategorized)
  const [selectedShelf, setSelectedShelf] = useState<string | null | undefined>(undefined)
  const [selectedCategory, setSelectedCategory] = useState<string | null | undefined>(undefined)
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | undefined>(undefined)
  const [tagChanges, setTagChanges] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const shelfRadioName = `batch-shelf-${useId()}`

  const shelves = shelvesData?.data ?? []
  const categories = categoryChoices(libraryCategories?.data ?? [])
  const tags = libraryId ? (libraryTags?.data ?? []) : (tagsData?.data ?? [])
  const initialShelf = items.every((item) => item.shelfId === items[0]?.shelfId) ? items[0]?.shelfId ?? null : undefined
  const initialCategory = items.every((item) => item.categoryId === items[0]?.categoryId) ? items[0]?.categoryId ?? null : undefined

  function handleClose() {
    if (!saving) onClose()
  }

  async function handleApply() {
    if (saving) return
    setSaving(true)
    try {
      const patch = {
        ids,
        ...(selectedShelf !== undefined ? { shelfId: selectedShelf } : {}),
        ...(selectedTemplateKey ? { categoryTemplateKey: selectedTemplateKey } : selectedCategory !== undefined ? { categoryId: selectedCategory } : {}),
        addTagIds: Object.keys(tagChanges).filter((id) => tagChanges[id]),
        removeTagIds: Object.keys(tagChanges).filter((id) => !tagChanges[id]),
      }
      const { device: localItems, server: serverSelection } = partitionByStore(items, (item) => item.ref)
      const serverItemIds = serverSelection.map((item) => item.id)
      let undo: UndoReceipt | undefined
      if (localItems.length) {
        const { ids: _organizeIds, ...organizePatch } = patch
        await vault.updateSelection(localItems, organizePatch)
        void queryClient.invalidateQueries({ queryKey: catalogQueryKey(DEVICE_VAULT_SCOPE, 'list').slice(0, -1) })
        if (!local) {
          invalidateDeviceMembershipQueries(queryClient)
          void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
        }
      }
      if (serverItemIds.length) {
        const result = await apiPatch<{ undo?: UndoReceipt }>(libraryId ? `/libraries/${libraryId}/books/batch/organize` : '/books/batch/organize', { ...patch, ids: serverItemIds })
        undo = result.undo
        void queryClient.invalidateQueries({ queryKey: ['books'] })
        void queryClient.invalidateQueries({ queryKey: ['shelves'] })
        void queryClient.invalidateQueries({ queryKey: ['tags'] })
        void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
        void queryClient.invalidateQueries({ queryKey: ['book'] })
        void queryClient.invalidateQueries({ queryKey: ['libraries', taxonomyLibraryId, 'categories'] })
        void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
        if (libraryId) {
          void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'catalog'] })
          void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'categories'] })
          void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'tags'] })
        }
      }
      const result: { undo?: UndoReceipt } = { undo: localItems.length ? undefined : undo }
      notify.success({ key: 'library.batchClassifySucceeded', params: { count: ids.length } }, { undo: result.undo })
      onDone()
      onClose()
    } catch {
      notify.error(_('library.batchOrganizeFailed'))
      setSaving(false)
    }
  }

  const showSave = selectedShelf !== undefined || selectedCategory !== undefined || selectedTemplateKey !== undefined || Object.keys(tagChanges).length > 0
  const currentShelfName = initialShelf === null
    ? _('library.notOnShelf')
    : shelves.find((shelf) => shelf.id === initialShelf)?.name
  const currentCategoryName = initialCategory === null
    ? _('library.uncategorized')
    : categories.find((category) => category.id === initialCategory)?.name

  return (
    <Modal
      title={<span className="flex items-center gap-2"><span>{_('library.batchOrganize')}</span><span className="text-xs font-normal text-stone-500">{_('library.taxonomySelectionCount', { count: ids.length })}</span></span>}
      closeLabel={_('library.close')}
      onClose={handleClose}
      size="sm"
      panelClassName="h-[min(30rem,calc(100dvh-1rem))] sm:h-[min(30rem,85vh)]"
      contentClassName="flex flex-col gap-3 overflow-hidden"
      footer={<div className="ml-auto flex items-center gap-2"><Button variant="secondary" onClick={handleClose} disabled={saving}>{_('library.cancel')}</Button><Button disabled={!showSave || saving} onClick={() => void handleApply()}>{_('library.save')}</Button></div>}
    >
      <div className="flex shrink-0 rounded-lg border border-stone-200 p-0.5 dark:border-stone-800">
        {(libraryId ? ['categories', 'tags'] as const : ['shelves', 'categories', 'tags'] as const).map((tab) => (
          <button key={tab} type="button" disabled={saving} onClick={() => setActiveTab(tab)} className={cn(
            'flex-1 rounded-md py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            activeTab === tab ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100' : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200',
          )}>
            {_(tab === 'categories' ? 'library.categories' : tab === 'shelves' ? 'library.shelves' : 'library.tags')}
          </button>
        ))}
      </div>
      <fieldset disabled={saving} className="min-h-0 min-w-0 flex-1">
        <div className="h-full min-h-0 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable]">
          {activeTab === 'shelves' ? (
            <div className="flex flex-col gap-0.5">
              {currentShelfName !== undefined && <p className="mb-1 px-2 text-xs text-stone-400">{_('library.batchCurrentShelf', { name: currentShelfName })}</p>}
              <TaxonomyChoiceRow label={_('library.keepShelf')} checked={selectedShelf === undefined} name={shelfRadioName} onChange={() => setSelectedShelf(undefined)} />
              <TaxonomyChoiceRow label={_('library.notOnShelf')} checked={selectedShelf === null} name={shelfRadioName} onChange={() => setSelectedShelf(null)} />
              {shelves.map((shelf) => <TaxonomyChoiceRow key={shelf.id} label={shelf.name} count={shelf.bookCount} checked={selectedShelf === shelf.id} name={shelfRadioName} onChange={() => setSelectedShelf(shelf.id)} />)}
            </div>
          ) : activeTab === 'categories' ? (
            <div className="space-y-2">
              {currentCategoryName !== undefined && <p className="px-2 text-xs text-stone-400">{_('library.batchCurrentCategory', { name: currentCategoryName })}</p>}
              <CategoryAssignmentSelector
                categories={libraryCategories?.data ?? []}
                categoryId={selectedCategory}
                categoryTemplateKey={selectedTemplateKey}
                allowTemplates={!libraryId}
                allowKeep
                onKeep={() => { setSelectedCategory(undefined); setSelectedTemplateKey(undefined) }}
                onChange={(value) => {
                  setSelectedCategory(value.categoryId)
                  setSelectedTemplateKey(value.categoryTemplateKey)
                }}
              />
            </div>
          ) : tags.length === 0 ? (
            <div className="space-y-2 py-4 text-center text-sm text-stone-400"><p>{_('library.noTags')}</p><p>{_('library.batchTagsHint')}</p></div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <p className="mb-1 px-2 text-xs text-stone-400">{_('library.batchTagsHint')}</p>
              {tags.map((tag) => {
                const count = items.filter((item) => item.tagIds.includes(tag.id)).length
                const state = tagChanges[tag.id] === undefined ? (count === 0 ? false : count === ids.length ? true : 'mixed') : tagChanges[tag.id]
                const targetCount = state === true ? ids.length : state === false ? 0 : count
                return <TaxonomyChoiceRow
                  key={tag.id}
                  label={tag.name}
                  ariaLabel={tag.name}
                  type="checkbox"
                  checked={state}
                  count={`${targetCount}/${ids.length}`}
                  onChange={() => setTagChanges((previous) => ({ ...previous, [tag.id]: state !== true }))}
                />
              })}
            </div>
          )}
        </div>
      </fieldset>
    </Modal>
  )
}

function BatchDeleteDialog({ ids, items, libraryId, trashEnabled, onRetainSelection, onClose, onDone }: {
  ids: string[]
  items: ClientBatchSelectionItem[]
  libraryId?: string
  trashEnabled: boolean
  onRetainSelection?: (ids: string[]) => void
  onClose: () => void
  onDone: () => void
}) {
  const _ = useTranslation()
  // A source context (the /local view) supplies its own vault operations;
  // the unified shelf has no context and binds the device vault directly.
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const [deleteUserData, setDeleteUserData] = useState(false)
  const collectedCount = items.filter((item) => item.kind === 'shared').length
  const ownedCount = libraryId ? 0 : items.length - collectedCount
  const versionCount = items.reduce((total, item) => total + (item.versionCount ?? 0), 0)

  async function handleDelete() {
    setDeleting(true)
    let succeeded = 0
    let failed = 0
    let failedKeys: string[] = []
    let undo: UndoReceipt | undefined
    const localRestores: Array<{ id: string; version: number }> = []
    const { device: localItems, server: serverItems } = partitionByStore(items, (item) => item.ref)
    if (!libraryId && trashEnabled && !deleteUserData) {
      const ownedIds = serverItems.filter((item) => item.kind !== 'shared').map((item) => item.id)
      const collectedIds = serverItems.filter((item) => item.kind === 'shared').map((item) => item.id)
      if (ownedIds.length) {
        try {
          const result = await apiPost<{ data: { succeeded: number; failed: number; failedIds: string[] }; undo?: UndoReceipt }>('/books/batch/trash', { ids: ownedIds })
          succeeded += result.data.succeeded
          failed += result.data.failed
          for (const failedId of result.data.failedIds) failedKeys.push(`server:${failedId}`)
          undo = result.undo
        } catch {
          notify.error(_('library.batchDeleteFailed'))
          onRetainSelection?.(items.map(catalogSelectionKey))
          setDeleting(false)
          return
        }
      }
      if (collectedIds.length) {
        const results = await settleBatch(collectedIds, (id) => apiDelete(`/books/${id}`))
        failed += results.filter((result) => result.status === 'rejected').length
        succeeded += results.length - results.filter((result) => result.status === 'rejected').length
        failedKeys.push(...collectedIds.filter((_, index) => results[index]?.status === 'rejected').map((id) => `server:${id}`))
      }
      if (localItems.length) {
        const results = await settleBatch(localItems, (item) => vault.trash({ scope: DEVICE_VAULT_SCOPE, bookId: item.id }, deleteUserData).then((receipt) => { if (receipt) localRestores.push({ id: item.id, version: receipt.version }) }))
        const branchFailed = results.filter((r) => r.status === 'rejected').length
        failed += branchFailed
        succeeded += results.length - branchFailed
        failedKeys.push(...localItems.filter((_, index) => results[index]?.status === 'rejected').map(catalogSelectionKey))
      }
    } else {
      const results = await settleBatch(items, async (item) => {
        if (isDeviceBook(item.ref)) return vault.trash({ scope: DEVICE_VAULT_SCOPE, bookId: item.id }, deleteUserData).then((receipt) => { if (receipt) localRestores.push({ id: item.id, version: receipt.version }) })
        return libraryId
          ? apiDelete(`/libraries/${libraryId}/books/${item.id}`)
          : apiDelete(`/books/${item.id}${deleteUserData ? '?deleteUserData=true' : ''}`)
      })
      failed = results.filter((r) => r.status === 'rejected').length
      succeeded = results.length - failed
      failedKeys = items.filter((_, index) => results[index]?.status === 'rejected').map(catalogSelectionKey)
    }
    if (localItems.length) {
      void queryClient.invalidateQueries({ queryKey: catalogQueryKey(DEVICE_VAULT_SCOPE, 'list').slice(0, -1) })
      if (!local) {
        invalidateDeviceMembershipQueries(queryClient)
        void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      }
    }
    if (serverItems.length) {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['shelves'] })
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
      if (libraryId) {
        void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'catalog'] })
        void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'categories'] })
        void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'tags'] })
      }
      if (!trashEnabled || deleteUserData) void invalidatePermanentlyDeletedBookQueries(queryClient)
    }
    let localUndo: UndoReceipt | undefined
    if (localRestores.length) {
      const undoToken = localRecordId()
      publishUndoOpportunity({
        token: undoToken,
        expiresAt: Date.now() + 10_000,
        queryKeys: [catalogQueryKey(DEVICE_VAULT_SCOPE, 'list').slice(0, -1)],
        execute: async () => {
          await vault.restoreSelection(localRestores)
          void queryClient.invalidateQueries({ queryKey: catalogQueryKey(DEVICE_VAULT_SCOPE, 'list').slice(0, -1) })
          if (!local) {
            invalidateDeviceMembershipQueries(queryClient)
            void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
          }
        },
      })
      localUndo = { token: undoToken, label: 'library.batchDeleteSucceeded' }
    }
    const batchUndo = localItems.length && serverItems.length ? undefined : (undo ?? localUndo)
    if (failed === 0) {
      notify.success({ key: 'library.batchDeleteSucceeded', params: { count: succeeded } }, { undo: batchUndo })
    } else {
      const showResult = succeeded > 0 ? notify.warning : notify.error
      showResult({
        key: succeeded > 0 ? 'library.batchPartial' : 'library.batchFailed',
        params: { action: _('library.batchActionDelete'), succeeded, failed },
      }, { undo: batchUndo })
      onRetainSelection?.(failedKeys)
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
            <p>{_(trashEnabled ? 'library.batchDeleteSharedTrash' : 'library.batchDeleteSharedPermanent', { count: ids.length, versions: versionCount })}</p>
          ) : (
            <>
              {ownedCount > 0 && <p>{_(trashEnabled ? 'library.batchDeleteOwnedTrash' : 'library.batchDeleteOwnedPermanent', { count: ownedCount })}</p>}
              {collectedCount > 0 && <p>{_('library.batchDeleteCollected', { count: collectedCount })}</p>}
              <ClearBookDataOption checked={deleteUserData} onChange={setDeleteUserData} deferred={trashEnabled && collectedCount === 0} />
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

function BatchPermanentDeleteDialog({ ids, keys, items, libraryId, onRetainSelection, onClose, onDone }: { ids: string[]; keys: string[]; items: ClientBatchSelectionItem[]; libraryId?: string; onRetainSelection?: (ids: string[]) => void; onClose: () => void; onDone: () => void }) {
  const _ = useTranslation()
  // A source context (the /local view) supplies its own vault operations;
  // the unified shelf has no context and binds the device vault directly.
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  // The selection query is skipped in trash mode, so the version map is only a
  // best-effort guard: a key is enough to know which store answers for the book.
  const [versions] = useState(() => Object.fromEntries(items.map((item) => [catalogSelectionKey(item), item.clientVersion])))

  async function handleDelete() {
    setDeleting(true)
    const results = await settleBatch(keys, (key) => {
      const bookId = catalogSelectionId(key)
      return catalogSelectionScope(key) === 'local'
        ? vault.purge({ scope: DEVICE_VAULT_SCOPE, bookId }, versions[key])
        : libraryId
          ? apiDelete(`/libraries/${libraryId}/books/${bookId}/permanent`)
          : apiDelete(`/books/${bookId}/permanent`)
    })
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    const hasServer = keys.some((key) => catalogSelectionScope(key) !== 'local')
    if (succeeded > 0 && hasServer) void invalidatePermanentlyDeletedBookQueries(queryClient)
    if (keys.some((key) => catalogSelectionScope(key) === 'local')) {
      void queryClient.invalidateQueries({ queryKey: catalogQueryKey(DEVICE_VAULT_SCOPE, 'list').slice(0, -1) })
      if (!local) {
        invalidateDeviceMembershipQueries(queryClient)
        void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      }
    }
    if (libraryId) {
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'tags'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
    }
    if (failed === 0) {
      notify.success({ key: 'library.batchPermanentDeleteSucceeded', params: { count: succeeded } })
    } else {
      const showResult = succeeded > 0 ? notify.warning : notify.error
      showResult({
        key: succeeded > 0 ? 'library.batchPartial' : 'library.batchFailed',
        params: { action: _('library.batchActionPermanentDelete'), succeeded, failed },
      })
    }
    if (failed === 0) {
      onDone()
      onClose()
    } else {
      onRetainSelection?.(keys.filter((_, index) => results[index]?.status === 'rejected'))
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
