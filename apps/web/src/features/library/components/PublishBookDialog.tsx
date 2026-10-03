import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { BookListItem, LibraryListItem, PublishedLinkInfo, PublishPrivateBookRes } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import ConfirmDialog from '@/components/ui/ConfirmDialog'

import { useLibraryCategories, useLibraryTags, usePublishPrivateBook, useBook, usePushVersion } from '../hooks'
import { categoryChoices } from '../taxonomy'

interface CustomSelectOption {
  value: string
  label: string
  icon?: ReactNode
}

interface CustomSelectProps {
  id?: string
  value: string
  onChange: (value: string) => void
  options: CustomSelectOption[]
  disabled?: boolean
  loading?: boolean
  placeholder?: string
}

function CustomSelect({ id, value, onChange, options, disabled = false, loading = false, placeholder }: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((opt) => opt.value === value)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        tabIndex={-1}
        className="sr-only"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none transition-all',
          'focus:border-stone-400 focus:ring-1 focus:ring-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:focus:border-stone-500',
          disabled && 'cursor-not-allowed opacity-50',
          loading && 'cursor-wait',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedOption?.icon}
          <span className={cn('truncate', !selectedOption && 'text-stone-400 dark:text-stone-500')}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </span>
        {loading ? (
          <svg className="h-3.5 w-3.5 shrink-0 animate-spin text-stone-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('shrink-0 text-stone-400 transition-transform duration-150', open && 'rotate-180')}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1.5 max-h-56 w-full overflow-y-auto rounded-xl border border-stone-200/90 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:border-stone-700 dark:bg-stone-800/95"
        >
          {options.map((opt) => {
            const isSelected = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors',
                  isSelected
                    ? 'bg-stone-100 font-semibold text-stone-900 dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-700/50 dark:hover:text-stone-100',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {opt.icon}
                  <span className="truncate">{opt.label}</span>
                </div>
                {isSelected && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-stone-900 dark:text-stone-100"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface PublishBookDialogProps {
  book: BookListItem | null
  libraries: LibraryListItem[]
  onClose: () => void
  onOpenLibrary: (libraryId: string) => void
}

export default function PublishBookDialog({ book, libraries, onClose, onOpenLibrary }: PublishBookDialogProps) {
  const _ = useTranslation()
  const userId = useAuthStore((state) => state.user?.id)
  const publishBook = usePublishPrivateBook()
  const pushVersion = usePushVersion()
  const { data: detailData } = useBook(book?.id ?? null)
  const publishedTo = detailData?.data.publishedTo ?? []
  const targets = useMemo(
    () => libraries.filter((library) => library.type === 'shared' && (library.relation === 'owner' || library.relation === 'admin')),
    [libraries],
  )
  const firstTargetId = targets[0]?.id ?? ''
  const targetPreferenceKey = userId ? `bd-publish-target-library:${userId}` : null
  const [selectedLibraryId, setSelectedLibraryId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [result, setResult] = useState<PublishPrivateBookRes | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  // Push is the one destructive-ish action in this dialog — it replaces what
  // the city serves — so it goes through a confirm. The prompt differs for a
  // target that moved on, because that is the case that actually loses work.
  const [pushTarget, setPushTarget] = useState<PublishedLinkInfo | null>(null)

  useEffect(() => {
    // Initialize (or repair) the selection only: the libraries list refetches
    // by identity, and resetting here would clobber an in-progress choice.
    if (selectedLibraryId && targets.some((target) => target.id === selectedLibraryId)) return
    let targetId = firstTargetId
    if (targetPreferenceKey) {
      try {
        const rememberedId = localStorage.getItem(targetPreferenceKey)
        if (rememberedId && targets.some((target) => target.id === rememberedId)) targetId = rememberedId
      } catch {
        // Storage may be unavailable; the first eligible library remains usable.
      }
    }
    setSelectedLibraryId(targetId)
  }, [firstTargetId, targetPreferenceKey, targets, selectedLibraryId])

  useEffect(() => {
    setResult(null)
    setCategoryId('')
    setTagIds([])
    setErrorKey(null)
  }, [book?.id])

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

  const libraryOptions: CustomSelectOption[] = useMemo(
    () => targets.map((lib) => ({
      value: lib.id,
      label: lib.name,
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
          <rect x="3" y="3" width="7" height="18" rx="1" />
          <rect x="14" y="3" width="7" height="18" rx="1" />
        </svg>
      ),
    })),
    [targets],
  )

  const categoryOptions: CustomSelectOption[] = useMemo(() => {
    const list = categoryChoices(categoriesData?.data ?? [])
    return [
      {
        value: '',
        label: _('library.uncategorized'),
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        ),
      },
      ...list.map((cat) => ({
        value: cat.id,
        label: cat.name,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ),
      })),
    ]
  }, [_, categoriesData?.data])

  if (!book) return null
  const currentBook = book

  const selectedLibrary = targets.find((library) => library.id === selectedLibraryId)
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
        onSuccess: (response) => {
          if (targetPreferenceKey) {
            try {
              localStorage.setItem(targetPreferenceKey, selectedLibraryId)
            } catch {
              // Publishing succeeded even if this device cannot save the preference.
            }
          }
          setResult(response.data)
        },
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
            <Button onClick={submit} disabled={publishBook.isPending || !selectedLibraryId} className="min-w-[5.5rem]">
              {publishBook.isPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>{_('library.publishing')}</span>
                </span>
              ) : (
                _('library.publish')
              )}
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
          {publishedTo.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-stone-600 dark:text-stone-300">{_('library.publishedTo')}</p>
              <ul className="flex flex-col gap-1.5">
                {publishedTo.map((entry) => (
                  <li
                    key={entry.versionLinkId}
                    className="flex items-center justify-between gap-2 rounded-xl border border-stone-200/80 bg-stone-50/50 px-3 py-2 dark:border-stone-800 dark:bg-stone-800/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-stone-700 dark:text-stone-200">
                        {entry.libraryName ?? entry.libraryId}
                        {entry.versionName ? ` · ${entry.versionName}` : ''}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-400 dark:text-stone-500">
                        {/* Four states, and only one of them is actionable. In
                            sync has nothing to send. This book leading is the
                            one push the server allows. The library leading —
                            with or without edits here — cannot be pushed over,
                            so those two offer the library's own version
                            instead, which is the only way forward. */}
                        {entry.inSync ? (
                          <>
                            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                            <span>{_('library.pushInSync')}</span>
                          </>
                        ) : !entry.cityMoved ? (
                          <>
                            <span className="size-1.5 rounded-full bg-blue-500" aria-hidden="true" />
                            <span className="text-stone-600 dark:text-stone-300">{_('library.pushSourceAhead')}</span>
                          </>
                        ) : entry.sourceMoved ? (
                          <>
                            <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                            <span className="text-amber-600 dark:text-amber-400">{_('library.pushDiverged')}</span>
                          </>
                        ) : (
                          <>
                            <span className="size-1.5 rounded-full bg-stone-400" aria-hidden="true" />
                            <span>{_('library.pushLibraryAhead')}</span>
                          </>
                        )}
                      </p>
                    </div>
                    {entry.inSync ? null : entry.cityMoved ? (
                      <button
                        type="button"
                        onClick={() => onOpenLibrary(entry.libraryId)}
                        className="shrink-0 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
                      >
                        {_('library.pushViewInLibrary')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPushTarget(entry)}
                        disabled={pushVersion.isPending}
                        className="shrink-0 rounded-lg bg-stone-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-60 disabled:hover:bg-stone-900 dark:bg-stone-100 dark:text-stone-900"
                      >
                        {_('library.pushNow')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300" htmlFor="publish-target-library">
              {_('library.publishTarget')}
            </label>
            <CustomSelect
              id="publish-target-library"
              value={selectedLibraryId}
              onChange={setSelectedLibraryId}
              options={libraryOptions}
              disabled={publishBook.isPending}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300" htmlFor="publish-target-category">
              {_('library.publishCategory')}
            </label>
            <CustomSelect
              id="publish-target-category"
              value={categoryId}
              onChange={setCategoryId}
              options={categoryOptions}
              disabled={publishBook.isPending}
              loading={categoriesLoading}
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-stone-600 dark:text-stone-300">{_('library.publishTags')}</p>
            {tagsLoading ? (
              <div className="flex flex-wrap gap-1.5 py-1" aria-busy="true">
                <div className="h-7 w-16 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800" />
                <div className="h-7 w-20 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800" />
                <div className="h-7 w-14 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800" />
              </div>
            ) : tags.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-200 px-3 py-2.5 text-center text-xs text-stone-400 dark:border-stone-800 dark:text-stone-500">
                {_('library.publishNoTags')}
              </div>
            ) : (
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {tags.map((tag) => {
                  const isSelected = tagIds.includes(tag.id)
                  return (
                    <label
                      key={tag.id}
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs select-none transition-colors',
                        isSelected
                          ? 'border-stone-900 bg-stone-900 font-medium text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                          : 'border-stone-200 text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-600',
                        publishBook.isPending && 'pointer-events-none opacity-60',
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={tag.name}
                        checked={isSelected}
                        onChange={() => toggleTag(tag.id)}
                        disabled={publishBook.isPending}
                        className="sr-only"
                      />
                      {isSelected ? (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          className="shrink-0"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : (
                        <span aria-hidden="true" className="text-[11px] text-stone-400 dark:text-stone-500">#</span>
                      )}
                      <span>{tag.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {errorKey && <p className="text-xs text-red-600 dark:text-red-400">{_(errorKey)}</p>}
        </div>
      )}
      {pushTarget && (
        <ConfirmDialog
          title={_('library.pushNow')}
          // Same "library · version" label the row already shows, so the
          // confirm names the exact target rather than "the library".
          message={_('library.pushSourceConfirm', {
            target: [pushTarget.libraryName ?? pushTarget.libraryId, pushTarget.versionName]
              .filter(Boolean).join(' · '),
          })}
          confirmLabel={_('library.pushConfirm')}
          confirmDisabled={pushVersion.isPending}
          onClose={() => setPushTarget(null)}
          onConfirm={() => {
            const target = pushTarget
            setPushTarget(null)
            pushVersion.mutate({
              libraryId: target.libraryId,
              libraryBookId: target.libraryBookId,
              versionLinkId: target.versionLinkId,
            }, {
              onSuccess: (response) => {
                if (response.data.alreadyUpToDate) notify.info({ key: 'library.pushAlreadyUpToDate' })
                else notify.success({ key: 'library.pushSuccess' })
              },
              onError: (err) => notify.error(getUserErrorNotification(err, 'library.pushFailed')),
            })
          }}
        />
      )}
    </Modal>
  )
}
