import { useState, useEffect } from 'react'

import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

import { useShelves, useTags, useUpdateBookMembership, useBookMembership } from '../hooks'

interface BookMembershipDialogProps {
  bookId: string | null
  bookTitle: string
  onClose: () => void
}

export default function BookMembershipDialog({ bookId, bookTitle, onClose }: BookMembershipDialogProps) {
  const { data: shelvesData, isLoading: shelvesLoading } = useShelves()
  const { data: tagsData, isLoading: tagsLoading } = useTags()
  const updateMembership = useUpdateBookMembership()
  const { shelves: currentShelves, tags: currentTags } = useBookMembership(bookId)

  const [selectedShelves, setSelectedShelves] = useState<Set<string>>(new Set())
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'shelves' | 'tags'>('shelves')

  const shelves = shelvesData?.data ?? []
  const tags = tagsData?.data ?? []

  useEffect(() => {
    if (currentShelves.data) {
      setSelectedShelves(new Set(currentShelves.data.data))
    }
  }, [currentShelves.data])

  useEffect(() => {
    if (currentTags.data) {
      setSelectedTags(new Set(currentTags.data.data))
    }
  }, [currentTags.data])

  const isLoading = shelvesLoading || tagsLoading || currentShelves.isLoading || currentTags.isLoading
  const hasChanges = true

  if (!bookId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-stone-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
            编辑归类
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
            aria-label={t().library.cancel}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="mb-4 truncate text-sm text-stone-500">{bookTitle}</p>

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
            {t().library.shelves}
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
            {t().library.tags}
          </button>
        </div>

        {isLoading ? (
          <div className="py-4 text-center text-sm text-stone-400">{t().reader.loading}</div>
        ) : activeTab === 'shelves' ? (
          shelves.length === 0 ? (
            <div className="py-4 text-center text-sm text-stone-400">{t().library.noShelves}</div>
          ) : (
            <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {shelves.map((shelf) => (
                <CheckboxItem
                  key={shelf.id}
                  id={shelf.id}
                  label={shelf.name}
                  count={shelf.bookCount}
                  checked={selectedShelves.has(shelf.id)}
                  onChange={() => toggleSet(selectedShelves, setSelectedShelves, shelf.id)}
                />
              ))}
            </div>
          )
        ) : tags.length === 0 ? (
          <div className="py-4 text-center text-sm text-stone-400">{t().library.noTags}</div>
        ) : (
          <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
            {tags.map((tag) => (
              <CheckboxItem
                key={tag.id}
                id={tag.id}
                label={tag.name}
                count={tag.bookCount}
                checked={selectedTags.has(tag.id)}
                onChange={() => toggleSet(selectedTags, setSelectedTags, tag.id)}
              />
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t().library.cancel}
          </Button>
          <Button
            disabled={!hasChanges || updateMembership.isPending}
            onClick={() => {
              updateMembership.mutate(
                { bookId, shelfIds: Array.from(selectedShelves), tagIds: Array.from(selectedTags) },
                { onSuccess: onClose },
              )
            }}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

function CheckboxItem({
  id,
  label,
  count,
  checked,
  onChange,
}: {
  id: string
  label: string
  count?: number
  checked: boolean
  onChange: () => void
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-800"
    >
      <span className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-200">
        <input
          id={id}
          type="checkbox"
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

function toggleSet(set: Set<string>, setSet: (s: Set<string>) => void, value: string) {
  const next = new Set(set)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  setSet(next)
}
