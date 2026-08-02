import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { ReadStatus } from '@bookdock/shared'

import { apiDelete, apiPatch, apiPut } from '@/api/client'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useToastStore } from '@/stores/toast.store'
import { Button } from '@/components/ui/Button'

import { useShelves, useTags } from '../hooks'

interface SelectionBarProps {
  selectedIds: string[]
  onClear: () => void
}

const BATCH_STATUS_ACTIONS: { value: ReadStatus; labelKey: string }[] = [
  { value: 'wishlist', labelKey: 'library.markWishlist' },
  { value: 'reading', labelKey: 'library.markReading' },
  { value: 'finished', labelKey: 'library.markFinished' },
  { value: 'idle', labelKey: 'library.markIdle' },
  { value: 'abandoned', labelKey: 'library.markAbandoned' },
]

export default function SelectionBar({ selectedIds, onClear }: SelectionBarProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const [dialog, setDialog] = useState<'classify' | 'delete' | null>(null)
  const [marking, setMarking] = useState(false)

  async function handleBatchStatus(value: ReadStatus) {
    setMarking(true)
    const results = await Promise.allSettled(selectedIds.map((bookId) => apiPatch(`/books/${bookId}`, { readStatus: value })))
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    addToast(
      failed === 0 ? _('library.batchSucceeded', { count: succeeded }) : _('library.batchPartial', { succeeded, failed }),
      failed === 0 ? 'success' : 'error',
    )
    setMarking(false)
    if (failed === 0) onClear()
  }

  return (
    <>
      <div className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-2xl border border-stone-200/80 bg-white/95 py-2 pl-4 pr-2 shadow-xl shadow-stone-900/8 backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95">
          <span className="mr-1 whitespace-nowrap text-xs font-medium text-stone-600 dark:text-stone-300">
            {_('library.selectionCount', { count: selectedIds.length })}
          </span>
          {BATCH_STATUS_ACTIONS.map((action) => (
            <Button
              key={action.value}
              variant="ghost"
              size="sm"
              disabled={marking}
              onClick={() => void handleBatchStatus(action.value)}
            >
              {_(action.labelKey)}
            </Button>
          ))}
          <span className="mx-1 h-4 w-px bg-stone-200 dark:bg-stone-700" />
          <Button variant="secondary" size="sm" onClick={() => setDialog('classify')}>
            {_('library.batchClassify')}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDialog('delete')}>
            {_('library.batchDelete')}
          </Button>
          <button
            type="button"
            onClick={onClear}
            aria-label={_('library.clearSelection')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
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
          onDone={onClear}
        />
      )}

      {dialog === 'delete' && (
        <BatchDeleteDialog
          ids={selectedIds}
          onClose={() => setDialog(null)}
          onDone={onClear}
        />
      )}
    </>
  )
}

function BatchClassifyDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const { data: shelvesData } = useShelves()
  const { data: tagsData } = useTags()
  const [activeTab, setActiveTab] = useState<'shelves' | 'tags'>('shelves')
  const [selectedShelves, setSelectedShelves] = useState<Set<string>>(new Set())
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())

  const shelves = shelvesData?.data ?? []
  const tags = tagsData?.data ?? []

  async function handleApply() {
    const shelfIds = Array.from(selectedShelves)
    const tagIds = Array.from(selectedTags)
    const results = await Promise.allSettled(ids.map((bookId) =>
      Promise.all([
        apiPut(`/books/${bookId}/shelves`, { shelfIds }),
        apiPut(`/books/${bookId}/tags`, { tagIds }),
      ]),
    ))
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    void queryClient.invalidateQueries({ queryKey: ['shelves'] })
    void queryClient.invalidateQueries({ queryKey: ['tags'] })
    addToast(
      failed === 0 ? _('library.batchSucceeded', { count: succeeded }) : _('library.batchPartial', { succeeded, failed }),
      failed === 0 ? 'success' : 'error',
    )
    if (failed === 0) {
      onDone()
      onClose()
    }
  }

  const showSave = selectedShelves.size > 0 || selectedTags.size > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-stone-900">
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
          shelves.length === 0 ? (
            <div className="py-4 text-center text-sm text-stone-400">{_('library.noShelves')}</div>
          ) : (
            <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {shelves.map((shelf) => (
                <label
                  key={shelf.id}
                  className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-800"
                >
                  <span className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-200">
                    <input
                      type="checkbox"
                      checked={selectedShelves.has(shelf.id)}
                      onChange={() => {
                        const next = new Set(selectedShelves)
                        if (next.has(shelf.id)) next.delete(shelf.id)
                        else next.add(shelf.id)
                        setSelectedShelves(next)
                      }}
                      className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-500 dark:border-stone-700"
                    />
                    <span className="truncate">{shelf.name}</span>
                  </span>
                  <span className="text-xs text-stone-400">{shelf.bookCount}</span>
                </label>
              ))}
            </div>
          )
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

function BatchDeleteDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    const results = await Promise.allSettled(ids.map((id) => apiDelete(`/books/${id}`)))
    const failed = results.filter((r) => r.status === 'rejected').length
    const succeeded = results.length - failed
    void queryClient.invalidateQueries({ queryKey: ['books'] })
    void queryClient.invalidateQueries({ queryKey: ['shelves'] })
    void queryClient.invalidateQueries({ queryKey: ['tags'] })
    addToast(
      failed === 0 ? _('library.batchSucceeded', { count: succeeded }) : _('library.batchPartial', { succeeded, failed }),
      failed === 0 ? 'success' : 'error',
    )
    if (failed === 0) {
      onDone()
      onClose()
    } else {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-stone-900">
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
