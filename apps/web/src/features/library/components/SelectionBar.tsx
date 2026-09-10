import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { ReadStatus } from '@bookdock/shared'

import { apiDelete, apiPatch, apiPost, apiPut } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import { useShelves, useTags } from '../hooks'

interface SelectionBarProps {
  selectedIds: string[]
  onClear: () => void
  onComplete?: () => void
  trash?: boolean
}

const BATCH_STATUS_ACTIONS: { value: ReadStatus; labelKey: string }[] = [
  { value: 'wishlist', labelKey: 'library.markWishlist' },
  { value: 'reading', labelKey: 'library.markReading' },
  { value: 'finished', labelKey: 'library.markFinished' },
  { value: 'idle', labelKey: 'library.markIdle' },
  { value: 'abandoned', labelKey: 'library.markAbandoned' },
]

export default function SelectionBar({ selectedIds, onClear, onComplete = onClear, trash = false }: SelectionBarProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<'classify' | 'delete' | 'permanent' | null>(null)
  const [marking, setMarking] = useState(false)

  async function runBatch(action: (bookId: string) => Promise<unknown>) {
    setMarking(true)
    const results = await Promise.allSettled(selectedIds.map(action))
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    if (failed === 0) {
      notify.success({ key: 'library.batchSucceeded', params: { count: succeeded } })
    } else {
      notify.error({ key: 'library.batchPartial', params: { succeeded, failed } })
    }
    setMarking(false)
    return failed === 0
  }

  async function handleBatchStatus(value: ReadStatus) {
    const ok = await runBatch((bookId) => apiPatch(`/books/${bookId}`, { readStatus: value }))
    if (ok) onComplete()
  }

  async function handleBatchRestore() {
    const ok = await runBatch((bookId) => apiPost(`/books/${bookId}/restore`))
    if (ok) onComplete()
  }

  return (
    <>
    <div className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 sm:bottom-5">
        <div className="flex w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] items-center gap-2 overflow-x-auto rounded-2xl border border-stone-200/80 bg-white/95 py-2 pl-4 pr-2 shadow-xl shadow-stone-900/8 backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:max-w-none dark:border-stone-700 dark:bg-stone-900/95">
          <span className="mr-1 whitespace-nowrap text-xs font-medium text-stone-600 dark:text-stone-300">
            {_('library.selectionCount', { count: selectedIds.length })}
          </span>
          {trash ? (
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
              {BATCH_STATUS_ACTIONS.map((action) => (
                <Button
                  key={action.value}
                  className="shrink-0 whitespace-nowrap"
                  variant="ghost"
                  size="sm"
                  disabled={marking}
                  onClick={() => void handleBatchStatus(action.value)}
                >
                  {_(action.labelKey)}
                </Button>
              ))}
              <span className="mx-1 h-4 w-px shrink-0 bg-stone-200 dark:bg-stone-700" />
              <Button className="shrink-0 whitespace-nowrap" variant="secondary" size="sm" onClick={() => setDialog('classify')}>
                {_('library.batchClassify')}
              </Button>
              <Button className="shrink-0 whitespace-nowrap" variant="danger" size="sm" onClick={() => setDialog('delete')}>
                {_('library.batchDelete')}
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
      </div>

      {dialog === 'classify' && (
        <BatchClassifyDialog
          ids={selectedIds}
          onClose={() => setDialog(null)}
          onDone={onComplete}
        />
      )}

      {dialog === 'delete' && (
        <BatchDeleteDialog
          ids={selectedIds}
          onClose={() => setDialog(null)}
          onDone={onComplete}
        />
      )}

      {dialog === 'permanent' && (
        <BatchPermanentDeleteDialog
          ids={selectedIds}
          onClose={() => setDialog(null)}
          onDone={onComplete}
        />
      )}
    </>
  )
}

function BatchClassifyDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const { data: shelvesData } = useShelves()
  const { data: tagsData } = useTags()
  const [activeTab, setActiveTab] = useState<'shelves' | 'tags'>('shelves')
  // undefined = untouched (no shelf PUT), null = move out of shelf (uncategorized)
  const [selectedShelf, setSelectedShelf] = useState<string | null | undefined>(undefined)
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())

  const shelves = shelvesData?.data ?? []
  const tags = tagsData?.data ?? []

  async function handleApply() {
    const tagIds = Array.from(selectedTags)
    const results = await Promise.allSettled(ids.map((bookId) =>
      Promise.all([
        selectedShelf !== undefined ? apiPut(`/books/${bookId}/shelves`, { shelfId: selectedShelf }) : Promise.resolve(),
        tagIds.length > 0 ? apiPut(`/books/${bookId}/tags`, { tagIds }) : Promise.resolve(),
      ]),
    ))
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    void queryClient.invalidateQueries({ queryKey: ['shelves'] })
    void queryClient.invalidateQueries({ queryKey: ['tags'] })
    if (failed === 0) {
      notify.success({ key: 'library.batchSucceeded', params: { count: succeeded } })
    } else {
      notify.error({ key: 'library.batchPartial', params: { succeeded, failed } })
    }
    if (failed === 0) {
      onDone()
      onClose()
    }
  }

  const showSave = selectedShelf !== undefined || selectedTags.size > 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-4">
      <div className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto rounded-t-xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-none sm:overflow-visible sm:rounded-xl dark:bg-stone-900">
        <h2 className="mb-4 font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
          {_('library.batchClassify')}
        </h2>
        <p className="mb-4 text-sm text-stone-500">
          {_('library.batchClassifyConfirm', { count: ids.length })}
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
            {_('library.shelves')}
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
          <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
            <ShelfRadio
              label={_('library.uncategorized')}
              checked={selectedShelf === null}
              onChange={() => setSelectedShelf(null)}
            />
            {shelves.map((shelf) => (
              <ShelfRadio
                key={shelf.id}
                label={shelf.name}
                count={shelf.bookCount}
                checked={selectedShelf === shelf.id}
                onChange={() => setSelectedShelf(shelf.id)}
              />
            ))}
          </div>
        ) : tags.length === 0 ? (
          <div className="py-4 text-center text-sm text-stone-400">{_('library.noTags')}</div>
        ) : (
          <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
            {tags.map((tag) => (
              <label
                key={tag.id}
                className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-800"
              >
                <span className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-200">
                  <input
                    type="checkbox"
                    checked={selectedTags.has(tag.id)}
                    onChange={() => {
                      const next = new Set(selectedTags)
                      if (next.has(tag.id)) next.delete(tag.id)
                      else next.add(tag.id)
                      setSelectedTags(next)
                    }}
                    className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-500 dark:border-stone-700"
                  />
                  <span className="truncate">{tag.name}</span>
                </span>
                <span className="text-xs text-stone-400">{tag.bookCount}</span>
              </label>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{_('library.cancel')}</Button>
          <Button disabled={!showSave} onClick={handleApply}>{_('library.save')}</Button>
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

function BatchDeleteDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    const results = await Promise.allSettled(ids.map((id) => apiDelete(`/books/${id}`)))
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    void queryClient.invalidateQueries({ queryKey: ['shelves'] })
    void queryClient.invalidateQueries({ queryKey: ['tags'] })
    if (failed === 0) {
      notify.success({ key: 'library.batchSucceeded', params: { count: succeeded } })
    } else {
      notify.error({ key: 'library.batchPartial', params: { succeeded, failed } })
    }
    if (failed === 0) {
      onDone()
      onClose()
    } else {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-4">
      <div className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto rounded-t-xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-none sm:overflow-visible sm:rounded-xl dark:bg-stone-900">
        <h2 className="mb-2 font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
          {_('library.batchDelete')}
        </h2>
        <p className="mb-6 text-sm text-stone-500">
          {_('library.batchDeleteConfirm', { count: ids.length })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            {_('library.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={deleting}
            onClick={() => void handleDelete()}
          >
            {_('library.batchDelete')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function BatchPermanentDeleteDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    const results = await Promise.allSettled(ids.map((id) => apiDelete(`/books/${id}/permanent`)))
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    if (failed === 0) {
      notify.success({ key: 'library.batchSucceeded', params: { count: succeeded } })
    } else {
      notify.error({ key: 'library.batchPartial', params: { succeeded, failed } })
    }
    if (failed === 0) {
      onDone()
      onClose()
    } else {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-4">
      <div className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto rounded-t-xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-none sm:overflow-visible sm:rounded-xl dark:bg-stone-900">
        <h2 className="mb-2 font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
          {_('library.permanentDelete')}
        </h2>
        <p className="mb-6 text-sm text-stone-500">
          {_('library.batchPermanentDeleteConfirm', { count: ids.length })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            {_('library.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={deleting}
            onClick={() => void handleDelete()}
          >
            {_('library.permanentDelete')}
          </Button>
        </div>
      </div>
    </div>
  )
}
