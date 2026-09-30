import { useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import i18n from 'i18next'

import type { BookDetailRes, BookListItem } from '@bookdock/shared'

import { useBookReplacements } from '@/api/hooks/useReplacements'
import { apiPatch } from '@/api/client'
import { Button } from '@/components/ui/Button'
import MenuFlyout from '@/components/ui/MenuFlyout'
import SmartMenu from '@/components/ui/SmartMenu'
import { formatRelativeTime } from '@/features/reader/components/format-relative-time'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { computeFromAnchor, type SmartPosition } from '@/lib/position'
import { cn, formatBytes, formatDate, formatDateTime } from '@/lib/utils'

import { copyCover, downloadBook, downloadCover, downloadEditedTxt, downloadEpub, downloadOriginalTxt } from '../../download'
import { useCollectBook, useForkBook, useRepinBook, useSourceStatus } from '../../hooks'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import BookCover from '../BookCover'
import ReadStatusChip from './ReadStatusChip'
import { copyValueOnClick, isMachineIdentifier, formatLanguage, formatWordCount } from './types'
import { resolveMetaSpanClasses, resolveMetaValueSizeClasses } from './meta-grid'
import { ActionIcon, FilterChip, GroupLabel, ExpandableRowValue } from './ui'

interface BookDetailViewProps {
  book: BookListItem
  readOnly?: boolean
  detail?: BookDetailRes
  shelfName?: string
  currentShelfId: string | null
  memberTags: Array<{ id: string; name: string }>
  isLoading?: boolean
  onEdit: () => void
  onDelete: (book: BookListItem) => void
  onClose: () => void
  onPublish?: (book: BookListItem) => void
}

export default function BookDetailView({
  book,
  readOnly = false,
  detail,
  shelfName,
  currentShelfId,
  memberTags,
  isLoading,
  onEdit,
  onDelete,
  onClose,
  onPublish,
}: BookDetailViewProps) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const collectBook = useCollectBook()
  const forkBook = useForkBook()
  const repinBook = useRepinBook()

  const displayBook = detail ?? book
  // A private B with a readable source may have an update to follow. The
  // status query runs only for such cards, never for A/C or library reads.
  const isPrivateB = !readOnly && Boolean(displayBook.source) && displayBook.collected !== false
  const { data: sourceStatus } = useSourceStatus(
    book.id,
    isPrivateB && !displayBook.sourceUnavailable,
  )
  const bookmeta = detail?.meta?.bookmeta

  const { data: replacementsData } = useBookReplacements(book.id)
  const hasEffectiveRules = useMemo(
    () => (replacementsData?.data ?? []).some((r) => (r.effectiveEnabled ?? r.enabled)),
    [replacementsData],
  )
  const canExportEdited = displayBook.format === 'txt' && hasEffectiveRules

  const [downloadMenu, setDownloadMenu] = useState<SmartPosition | null>(null)
  const [forkConfirmOpen, setForkConfirmOpen] = useState(false)
  const downloadAnchorRef = useRef<HTMLDivElement>(null)
  const downloadMenuRef = useRef<HTMLDivElement>(null)

  const hasCoverImage = Boolean(displayBook.coverKey || displayBook.format === 'epub')
  const [copyingCover, setCopyingCover] = useState(false)

  async function handleCopyCover() {
    if (copyingCover) return
    setCopyingCover(true)
    try {
      await copyCover(book.id)
      notify.success(_('library.coverCopied'))
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.copyCoverFailed'))
    } finally {
      setCopyingCover(false)
    }
  }

  async function handleDownloadCover() {
    try {
      await downloadCover(book.id, book.title)
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'errors.downloadFailed'))
    }
  }

  function toggleDownloadMenu() {
    const el = downloadAnchorRef.current
    if (!el) return
    if (downloadMenu) {
      setDownloadMenu(null)
      return
    }
    const rect = el.getBoundingClientRect()
    setDownloadMenu(
      computeFromAnchor(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        176,
        96,
      ),
    )
  }

  async function toggleHidden() {
    try {
      await apiPatch(`/books/${book.id}`, { hidden: !displayBook.hidden })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'toast.updateBookFailed'))
    }
  }

  async function onExport(format: 'epub' | 'txt', plain: boolean) {
    setDownloadMenu(null)
    try {
      if (format === 'epub') {
        await downloadEpub(book.id, book.title, { plain })
      } else if (plain) {
        await downloadOriginalTxt(book.id, book.title)
      } else {
        await downloadEditedTxt(book.id, book.title)
      }
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'errors.downloadFailed'))
    }
  }

  function goToFilter(search: { shelf?: string; tag?: string; author?: string; series?: string }) {
    onClose()
    void navigate({ to: '/', search })
  }

  const hasProgress = displayBook.progress != null && displayBook.progress > 0
  const hasReadingState = hasProgress || Boolean(displayBook.lastReadAt)
  const rawIdentifier = bookmeta?.isbn || bookmeta?.identifier || ''
  const isIsbn = Boolean(bookmeta?.isbn)

  const metaRows: {
    label: string
    value: string
    copyable?: boolean
    onClick?: () => void
    expandable?: boolean
    hint?: string
  }[] = []
  const groupDigits = (n: number): string => new Intl.NumberFormat(i18n.language).format(n)
  if (bookmeta?.series) {
    metaRows.push({
      label: _('library.seriesSection'),
      value: bookmeta.seriesIndex != null ? `${bookmeta.series} #${bookmeta.seriesIndex}` : bookmeta.series,
      onClick: () => goToFilter({ series: bookmeta.series }),
    })
  }
  if (bookmeta?.publisher) metaRows.push({ label: _('library.publisher'), value: bookmeta.publisher })
  if (bookmeta?.published) metaRows.push({ label: _('library.published'), value: bookmeta.published })
  if (bookmeta?.language) {
    metaRows.push({ label: _('library.language'), value: formatLanguage(bookmeta.language, i18n.language) })
  }
  if (rawIdentifier && (isIsbn || !isMachineIdentifier(rawIdentifier))) {
    metaRows.push({ label: isIsbn ? 'ISBN' : _('library.identifier'), value: rawIdentifier, copyable: true, hint: _('library.copyValue') })
  }
  metaRows.push({ label: _('library.format'), value: displayBook.format.toUpperCase() })
  metaRows.push({ label: _('library.sortBy.size'), value: formatBytes(displayBook.size), hint: `${groupDigits(displayBook.size)} B` })
  if (detail?.meta?.wordCount != null) {
    const wordCount = detail.meta.wordCount
    metaRows.push({
      label: _('library.wordCount'),
      value: formatWordCount(wordCount, i18n.language, _),
      hint: _('library.tocRuleWords', { count: groupDigits(wordCount) }),
    })
  }
  metaRows.push({ label: _('library.addedAt'), value: formatDate(displayBook.createdAt), hint: formatDateTime(displayBook.createdAt) })
  if (displayBook.updatedAt !== displayBook.createdAt) {
    metaRows.push({ label: _('library.updatedAt'), value: formatDate(displayBook.updatedAt), hint: formatDateTime(displayBook.updatedAt) })
  }
  if (bookmeta?.subjects?.length) {
    metaRows.push({ label: _('library.subjects'), value: bookmeta.subjects.join('、'), expandable: true })
  }
  if (detail?.meta?.fileName) {
    metaRows.push({ label: _('library.originalFile'), value: detail.meta.fileName, copyable: true, expandable: true, hint: _('library.copyFullFileName') })
  }
  const metaSpanClasses = resolveMetaSpanClasses(metaRows.map((row) => row.value))
  const metaValueSizeClasses = resolveMetaValueSizeClasses(metaRows.map((row) => row.value))

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
        <div className="group/cover relative w-32 shrink-0 self-center overflow-hidden rounded-xl shadow-md shadow-stone-900/10 sm:self-start">
          <BookCover book={displayBook} coverPaletteId={detail?.meta?.coverPaletteId} />
          {hasCoverImage && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 transition-opacity duration-200 group-hover/cover:pointer-events-auto group-hover/cover:opacity-100 group-focus-within/cover:pointer-events-auto group-focus-within/cover:opacity-100">
              <button
                type="button"
                onClick={handleCopyCover}
                disabled={copyingCover}
                title={_('library.copyCover')}
                aria-label={_('library.copyCover')}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-white/20 text-white backdrop-blur-xs transition hover:scale-110 hover:bg-white/30 active:scale-95 disabled:opacity-50"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleDownloadCover}
                title={_('library.downloadCover')}
                aria-label={_('library.downloadCover')}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-white/20 text-white backdrop-blur-xs transition hover:scale-110 hover:bg-white/30 active:scale-95"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" x2="12" y1="15" y2="3" />
                </svg>
              </button>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-xl font-semibold leading-snug text-stone-900 dark:text-stone-100">
            {displayBook.title}
          </h3>
          {(displayBook.authors ?? []).length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
              {(displayBook.authors ?? []).map((name, index) => (
                <span key={`${name}-${index}`} className="flex items-center gap-x-1">
                  {index > 0 && <span aria-hidden="true" className="text-stone-300 dark:text-stone-600">·</span>}
                  <button
                    type="button"
                    onClick={() => goToFilter({ author: name })}
                    className="text-left text-stone-500 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-400 dark:decoration-stone-600 dark:hover:text-stone-100"
                  >
                    {name}
                  </button>
                </span>
              ))}
            </div>
          ) : displayBook.author ? (
            <button
              type="button"
              onClick={() => goToFilter({ author: displayBook.author })}
              className="mt-1 text-left text-sm text-stone-500 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-400 dark:decoration-stone-600 dark:hover:text-stone-100"
            >
              {displayBook.author}
            </button>
          ) : (
            <p className="mt-1 text-sm text-stone-400 dark:text-stone-500">
              {_('library.unknown')}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <ReadStatusChip book={displayBook} />
            {displayBook.source && (
              // 7.7: where a collected card came from. A deleted source keeps
              // its id, so the chip degrades to "unavailable" instead of
              // pretending the book was uploaded here.
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-stone-200/80 bg-stone-50/80 px-2.5 py-0.5 text-[11px] font-medium text-stone-600 dark:border-stone-700/80 dark:bg-stone-800/80 dark:text-stone-300"
                title={displayBook.source.libraryName ? _('library.fromLibrary', { name: displayBook.source.libraryName }) : _('library.sourceUnavailable')}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400 dark:text-stone-500" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="18" rx="1" />
                  <rect x="14" y="3" width="7" height="18" rx="1" />
                </svg>
                <span className="truncate max-w-[12rem]">
                  {displayBook.source.libraryName || _('library.sourceUnavailable')}
                </span>
              </span>
            )}
            {displayBook.collected === false && displayBook.source?.libraryBookVersionId && (
              // 0.4.0: reading in library context is free, collecting gives the
              // book a home (shelf, tags, deletion) in the private library.
              <button
                type="button"
                onClick={() => collectBook.mutate({
                  libraryId: displayBook.source!.libraryId,
                  versionLinkId: displayBook.source!.libraryBookVersionId!,
                }, {
                  onSuccess: (res) => {
                    notify[res.data.alreadyExists ? 'info' : 'success'](
                      res.data.alreadyExists ? _('library.collectAlready') : _('library.collectSuccess'),
                    )
                    void queryClient.invalidateQueries({ queryKey: ['books'] })
                  },
                  onError: (err) => notify.error(getUserErrorNotification(err, 'library.collectFailed')),
                })}
                disabled={collectBook.isPending}
                className="rounded-full bg-stone-900 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900"
              >
                {_('library.collect')}
              </button>
            )}

            {isPrivateB && !displayBook.sourceUnavailable && sourceStatus?.data.hasUpdate && (
              // B follow-up: the source published past the pin. Following is
              // explicit only; content changes under the same id.
              <button
                type="button"
                onClick={() => repinBook.mutate({ bookId: book.id }, {
                  onSuccess: (res) => {
                    notify[res.data.alreadyUpToDate ? 'info' : 'success'](
                      res.data.alreadyUpToDate ? _('library.repinAlreadyUpToDate') : _('library.repinSuccess'),
                    )
                  },
                  onError: (err) => notify.error(getUserErrorNotification(err, 'library.repinFailed')),
                })}
                disabled={repinBook.isPending}
                className="inline-flex items-center gap-1 rounded-full border border-blue-200/90 bg-blue-50/90 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 dark:border-blue-800/80 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/60"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-blue-500">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 16h5v5" />
                </svg>
                <span>{_('library.repinToLatest')}</span>
              </button>
            )}
            {shelfName && currentShelfId ? (
              <FilterChip prefix="📁" label={shelfName} onClick={() => goToFilter({ shelf: currentShelfId })} />
            ) : null}
            {memberTags.map((tag) => (
              <FilterChip key={tag.id} prefix="#" label={tag.name} onClick={() => goToFilter({ tag: tag.id })} />
            ))}
          </div>

          {hasReadingState && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
                {hasReadingState ? (
                  <span className="tabular-nums font-medium text-stone-600 dark:text-stone-300">
                    {Math.round(displayBook.progress ?? 0)}%
                  </span>
                ) : (
                  <span />
                )}
                {displayBook.lastReadAt ? (
                  <span className="text-[11px] text-stone-400 dark:text-stone-500" title={formatDateTime(displayBook.lastReadAt)}>
                    {formatRelativeTime(_, displayBook.lastReadAt)}
                  </span>
                ) : null}
              </div>
              {hasReadingState && (
                <div
                  role="progressbar"
                  aria-label={_('library.readingProgress')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(displayBook.progress ?? 0)}
                  className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
                >
                  <div
                    className="h-full rounded-full bg-stone-700 dark:bg-stone-400"
                    style={{ width: `${displayBook.progress ?? 0}%` }}
                  />
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                onClose()
                void navigate({ to: '/books/$id', params: { id: book.id } })
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              {hasProgress ? _('library.continueReading') : _('library.startReading')}
            </Button>
            <div className="flex flex-1 items-center gap-1.5">
              {!readOnly && <ActionIcon secondary label={_('library.edit')} onClick={onEdit}>
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </ActionIcon>}
              {!readOnly && (
                <ActionIcon
                  secondary
                  label={displayBook.hidden ? _('library.privateHiddenAction') : _('library.privateVisibleAction')}
                  onClick={() => void toggleHidden()}
                >
                  {displayBook.hidden ? (
                    <>
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" x2="22" y1="2" y2="22" />
                    </>
                  ) : (
                    <>
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </ActionIcon>
              )}
              {!readOnly && onPublish && (
                <ActionIcon
                  secondary
                  label={_('library.publish')}
                  onClick={() => onPublish(displayBook)}
                >
                  <path d="M12 17V3" />
                  <path d="m7 8 5-5 5 5" />
                  <path d="M5 21h14" />
                </ActionIcon>
              )}
              {!readOnly && <div ref={downloadAnchorRef} className="relative">
                <ActionIcon
                  secondary
                  label={_('library.download')}
                  onClick={
                    displayBook.format === 'txt'
                      ? toggleDownloadMenu
                      : () =>
                          void Promise.resolve(downloadBook(book.id, book.title)).catch((err) =>
                            notify.error(getUserErrorNotification(err, 'errors.downloadFailed')),
                          )
                  }
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </ActionIcon>
                {downloadMenu && (
                  <SmartMenu
                    innerRef={downloadMenuRef}
                    position={downloadMenu}
                    onClose={() => setDownloadMenu(null)}
                  >
                    {canExportEdited && (
                      <MenuFlyout
                        panelWidth={96}
                        row={({ open, flip, toggle }) => (
                          <button
                            type="button"
                            onClick={toggle}
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-stone-500/10 ${open ? 'bg-stone-500/10' : ''}`}
                          >
                            <span className="flex-1">{_('library.edited')}</span>
                            <FlyoutChevron flip={flip} />
                          </button>
                        )}
                      >
                        {(close) => (
                          <ExportFormats
                            onPick={(format) => {
                              close()
                              void onExport(format, false)
                            }}
                          />
                        )}
                      </MenuFlyout>
                    )}
                    <MenuFlyout
                      panelWidth={96}
                      row={({ open, flip, toggle }) => (
                        <button
                          type="button"
                          onClick={toggle}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-stone-500/10 ${open ? 'bg-stone-500/10' : ''}`}
                        >
                          <span className="flex-1">{_('library.original')}</span>
                          <FlyoutChevron flip={flip} />
                        </button>
                      )}
                    >
                      {(close) => (
                        <ExportFormats
                          onPick={(format) => {
                            close()
                            void onExport(format, true)
                          }}
                        />
                      )}
                    </MenuFlyout>
                  </SmartMenu>
                )}
              </div>}
              {isPrivateB && !displayBook.sourceUnavailable && (
                <ActionIcon
                  secondary
                  label={_('library.forkLocal')}
                  onClick={() => setForkConfirmOpen(true)}
                  disabled={forkBook.isPending}
                >
                  <circle cx="12" cy="18" r="3" />
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="18" cy="6" r="3" />
                  <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
                  <path d="M12 12v3" />
                </ActionIcon>
              )}
              {!readOnly && <div className="ml-auto">
                <ActionIcon label={displayBook.source ? _('library.removeFromLibrary') : _('library.delete')} danger onClick={() => onDelete(book)}>
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                </ActionIcon>
              </div>}
            </div>
          </div>
        </div>
      </div>

      {bookmeta?.description && (
        <section className="mt-5">
          <GroupLabel>{_('library.descriptionSection')}</GroupLabel>
          <p className="max-h-40 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-600 dark:text-stone-300">
            {bookmeta.description}
          </p>
        </section>
      )}

      <section className="mt-5">
        <div className="rounded-xl border border-stone-200/70 bg-stone-50/70 p-3.5 dark:border-stone-800 dark:bg-stone-800/40">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {metaRows.map((row, index) => (
              <div key={row.label} className={cn('min-w-0', metaSpanClasses[index])}>
                <dt className="text-xs text-stone-400 dark:text-stone-500">{row.label}</dt>
                {row.copyable ? (
                  <dd className="mt-0.5">
                    {row.expandable ? (
                      <ExpandableRowValue
                        value={row.value}
                        mono
                        textClass={metaValueSizeClasses[index] || 'text-sm'}
                        onCopy={() => copyValueOnClick(row.value)}
                        copyHint={row.hint}
                        expandLabel={_('library.expand')}
                        collapseLabel={_('library.collapse')}
                      />
                    ) : (
                      <button
                        type="button"
                        title={row.hint ?? row.value}
                        onClick={() => copyValueOnClick(row.value)}
                        className="block max-w-full cursor-pointer truncate text-left font-mono text-sm text-stone-700 hover:underline dark:text-stone-200"
                      >
                        {row.value}
                      </button>
                    )}
                  </dd>
                ) : row.onClick ? (
                  <dd className="mt-0.5">
                    <button
                      type="button"
                      title={row.value}
                      onClick={row.onClick}
                      className={cn('line-clamp-2 break-words text-left text-stone-700 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-200 dark:decoration-stone-600 dark:hover:text-stone-100', metaValueSizeClasses[index] || 'text-sm')}
                    >
                      {row.value}
                    </button>
                  </dd>
                ) : row.expandable ? (
                  <dd className="mt-0.5">
                    <ExpandableRowValue
                      value={row.value}
                      wrapClass="break-words"
                      textClass={metaValueSizeClasses[index] || 'text-sm'}
                      expandLabel={_('library.expand')}
                      collapseLabel={_('library.collapse')}
                    />
                  </dd>
                ) : (
                  <dd title={row.hint} className={cn('mt-0.5 line-clamp-2 break-words text-stone-700 dark:text-stone-200', metaValueSizeClasses[index] || 'text-sm')}>{row.value}</dd>
                )}
              </div>
            ))}
            {isLoading && (
              <>
                <div className="min-w-0 space-y-1">
                  <div className="h-3 w-12 animate-pulse rounded bg-stone-200/70 dark:bg-stone-700/50" />
                  <div className="h-4 w-20 animate-pulse rounded bg-stone-200/50 dark:bg-stone-700/30" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="h-3 w-10 animate-pulse rounded bg-stone-200/70 dark:bg-stone-700/50" />
                  <div className="h-4 w-24 animate-pulse rounded bg-stone-200/50 dark:bg-stone-700/30" />
                </div>
              </>
            )}
          </dl>
        </div>
      </section>

      {forkConfirmOpen && (
        <ConfirmDialog
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="6" r="3" />
              <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
              <path d="M12 12v3" />
            </svg>
          }
          title={_('library.forkLocalTitle')}
          message={_('library.forkLocalConfirm')}
          warning={_('library.forkLocalWarning')}
          confirmLabel={_('library.forkLocalConfirmBtn')}
          confirmVariant="primary"
          confirmDisabled={forkBook.isPending}
          onConfirm={() => forkBook.mutate({ bookId: book.id }, {
            onSuccess: () => {
              notify.success(_('library.forkLocalSuccess'))
              void queryClient.invalidateQueries({ queryKey: ['books'] })
              setForkConfirmOpen(false)
              onClose()
            },
            onError: (err) => {
              notify.error(getUserErrorNotification(err, 'library.forkLocalFailed'))
              setForkConfirmOpen(false)
            },
          })}
          onClose={() => setForkConfirmOpen(false)}
        />
      )}
    </div>
  )
}

function FlyoutChevron({ flip }: { flip: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-stone-400 transition-transform ${flip ? 'rotate-180' : ''}`}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

const exportItemClass =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-stone-500/10'

function ExportFormats({ onPick }: { onPick: (format: 'epub' | 'txt') => void }) {
  return (
    <>
      <button type="button" onClick={() => onPick('epub')} className={exportItemClass}>
        EPUB
      </button>
      <button type="button" onClick={() => onPick('txt')} className={exportItemClass}>
        TXT
      </button>
    </>
  )
}
