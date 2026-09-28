import { useEffect, useMemo, useState } from 'react'

import type { BookListItem, LibraryListItem, PublishPrivateBookRes } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'

import { useLibraryCategories, useLibraryTags, usePublishPrivateBook } from '../hooks'

interface PublishBookDialogProps {
  book: BookListItem | null
  libraries: LibraryListItem[]
  onClose: () => void
  onOpenLibrary: (libraryId: string) => void
}

export default function PublishBookDialog({ book, libraries, onClose, onOpenLibrary }: PublishBookDialogProps) {
  const _ = useTranslation()
  const publishBook = usePublishPrivateBook()
  const targets = useMemo(
    () => libraries.filter((library) => library.type === 'shared' && (library.relation === 'owner' || library.relation === 'admin')),
    [libraries],
  )
  const firstTargetId = targets[0]?.id ?? ''
  const [selectedLibraryId, setSelectedLibraryId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [result, setResult] = useState<PublishPrivateBookRes | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  useEffect(() => {
    setSelectedLibraryId(firstTargetId)
    setCategoryId('')
    setTagIds([])
    setResult(null)
    setErrorKey(null)
  }, [book?.id, firstTargetId])

  useEffect(() => {
    setCategoryId('')
    setTagIds([])
    setErrorKey(null)
  }, [selectedLibraryId])

  const { data: categoriesData, isLoading: categoriesLoading } = useLibraryCategories(selectedLibraryId || null, {
    enabled: Boolean(book && selectedLibraryId && !result),
  })
  const { data: tagsData, isLoading: tagsLoading } = useLibraryTags(selectedLibraryId || null, {
    enabled: Boolean(book && selectedLibraryId && !result),
  })

  if (!book) return null
  const currentBook = book

  const selectedLibrary = targets.find((library) => library.id === selectedLibraryId)
  const categories = categoriesData?.data ?? []
  const tags = tagsData?.data ?? []

  function toggleTag(tagId: string) {
    setTagIds((current) => current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId])
  }

  function submit() {
    if (!selectedLibraryId) return
    setErrorKey(null)
    publishBook.mutate(
      {
        libraryId: selectedLibraryId,
        bookId: currentBook.id,
        categoryId: categoryId || undefined,
        tagIds,
      },
      {
        onSuccess: (response) => setResult(response.data),
        onError: (error) => setErrorKey(getUserErrorNotification(error, 'library.publishFailed').key),
      },
    )
  }

  return (
    <Modal
      title={_('library.publishTitle', { title: book.title })}
      onClose={onClose}
      closeLabel={_('library.close')}
      size="default"
      footer={result ? (
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{_('library.stayInLibrary')}</Button>
          <Button onClick={() => onOpenLibrary(selectedLibraryId)}>{_('library.openLibrary')}</Button>
        </div>
      ) : (
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={publishBook.isPending}>{_('library.cancel')}</Button>
          {targets.length > 0 && (
            <Button onClick={submit} disabled={publishBook.isPending || !selectedLibraryId}>
              {publishBook.isPending ? `${_('library.publish')}...` : _('library.publish')}
            </Button>
          )}
        </div>
      )}
    >
      {result ? (
        <div className="space-y-3 py-4 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 4 4L19 6" />
            </svg>
          </div>
          <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
            {result.duplicated ? _('library.publishAlreadyExists') : _('library.publishSuccess')}
          </p>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {_('library.publishSuccessDescription', { library: selectedLibrary?.name ?? '' })}
          </p>
        </div>
      ) : targets.length === 0 ? (
        <div className="space-y-2 py-6 text-center">
          <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('library.publishNoTargets')}</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">{_('library.publishNoTargetsDescription')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300" htmlFor="publish-target-library">
              {_('library.publishTarget')}
            </label>
            <select
              id="publish-target-library"
              value={selectedLibraryId}
              onChange={(event) => setSelectedLibraryId(event.target.value)}
              className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            >
              {targets.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300" htmlFor="publish-target-category">
              {_('library.publishCategory')}
            </label>
            <select
              id="publish-target-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              disabled={categoriesLoading}
              className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none focus:border-stone-400 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            >
              <option value="">{_('library.uncategorized')}</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-stone-600 dark:text-stone-300">{_('library.publishTags')}</p>
            {tagsLoading ? (
              <p className="text-xs text-stone-400">{_('reader.loading')}</p>
            ) : tags.length === 0 ? (
              <p className="text-xs text-stone-400">{_('library.publishNoTags')}</p>
            ) : (
              <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                {tags.map((tag) => (
                  <label key={tag.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-300">
                    <input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} className="rounded border-stone-300 text-stone-900 focus:ring-stone-500" />
                    {tag.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <p className="rounded-xl bg-stone-50 px-3 py-2.5 text-xs leading-5 text-stone-500 dark:bg-stone-800/70 dark:text-stone-400">
            {_('library.publishDescription')}
          </p>
          {errorKey && <p className="text-xs text-red-600 dark:text-red-400">{_(errorKey)}</p>}
        </div>
      )}
    </Modal>
  )
}
