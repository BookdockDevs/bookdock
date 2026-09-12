import { useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import type { BookDetailRes, BookListItem } from '@bookdock/shared'

import { useBookTransforms } from '@/api/hooks/useTransforms'
import { Button } from '@/components/ui/Button'
import MenuFlyout from '@/components/ui/MenuFlyout'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { computeFromAnchor, type SmartPosition } from '@/lib/position'
import { formatBytes, formatDate } from '@/lib/utils'

import { downloadBook, downloadEditedTxt, downloadEpub, downloadOriginalTxt } from '../../download'
import BookCover from '../BookCover'
import ReadStatusChip from './ReadStatusChip'
import { copyText, middleTruncate } from './types'
import { ActionIcon, FilterChip, GroupLabel } from './ui'

interface BookDetailViewProps {
  book: BookListItem
  detail?: BookDetailRes
  shelfName?: string
  currentShelfId: string | null
  memberTags: Array<{ id: string; name: string }>
  onEdit: () => void
  onDelete: (book: BookListItem) => void
  onClose: () => void
}

export default function BookDetailView({
  book,
  detail,
  shelfName,
  currentShelfId,
  memberTags,
  onEdit,
  onDelete,
  onClose,
}: BookDetailViewProps) {
  const _ = useTranslation()
  const navigate = useNavigate()

  const displayBook = detail ?? book
  const bookmeta = detail?.meta?.bookmeta

  const { data: transformsData } = useBookTransforms(book.id)
  const hasEffectiveRules = useMemo(
    () => (transformsData?.data ?? []).some((r) => (r.effectiveEnabled ?? r.enabled)),
    [transformsData],
  )
  const canExportEdited = displayBook.format === 'txt' && hasEffectiveRules

  const [downloadMenu, setDownloadMenu] = useState<SmartPosition | null>(null)
  const downloadAnchorRef = useRef<HTMLDivElement>(null)
  const downloadMenuRef = useRef<HTMLDivElement>(null)

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
  const identifier = bookmeta?.isbn || bookmeta?.identifier || ''

  const metaRows: { label: string; value: string; copyable?: boolean; onClick?: () => void }[] = []
  if (bookmeta?.publisher) metaRows.push({ label: _('library.publisher'), value: bookmeta.publisher })
  if (bookmeta?.published) metaRows.push({ label: _('library.published'), value: bookmeta.published })
  metaRows.push({ label: _('library.updatedAt'), value: formatDate(displayBook.updatedAt) })
  metaRows.push({ label: _('library.addedAt'), value: formatDate(displayBook.createdAt) })
  if (bookmeta?.language) metaRows.push({ label: _('library.language'), value: bookmeta.language })
  if (bookmeta?.subjects?.length) metaRows.push({ label: _('library.subjects'), value: bookmeta.subjects.join('、') })
  metaRows.push({ label: _('library.format'), value: displayBook.format.toUpperCase() })
  metaRows.push({ label: _('library.sortBy.size'), value: formatBytes(displayBook.size) })
  if (identifier) metaRows.push({ label: bookmeta?.isbn ? 'ISBN' : _('library.identifier'), value: identifier, copyable: true })
  if (bookmeta?.series) {
    metaRows.push({
      label: _('library.seriesSection'),
      value: bookmeta.seriesIndex != null ? `${bookmeta.series} #${bookmeta.seriesIndex}` : bookmeta.series,
      onClick: () => goToFilter({ series: bookmeta.series }),
    })
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
        <div className="w-32 shrink-0 self-center sm:self-auto">
          <BookCover book={displayBook} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-xl font-semibold leading-snug text-stone-900 dark:text-stone-100">
            {displayBook.title}
          </h3>
          {displayBook.author ? (
            <button
              type="button"
              onClick={() => goToFilter({ author: displayBook.author })}
              className="mt-1 text-left text-sm text-stone-500 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-400 dark:decoration-stone-600 dark:hover:text-stone-100"
            >
              {displayBook.author}
            </button>
          ) : (
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {_('library.unknown')}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <ReadStatusChip book={displayBook} />
            <span className="rounded-md bg-stone-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-stone-100 dark:text-stone-900">
              {displayBook.format}
            </span>
            {shelfName && currentShelfId ? (
              <FilterChip label={shelfName} onClick={() => goToFilter({ shelf: currentShelfId })} />
            ) : null}
            {memberTags.map((tag) => (
              <FilterChip key={tag.id} label={tag.name} onClick={() => goToFilter({ tag: tag.id })} />
            ))}
          </div>

          {hasProgress && (
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                <div
                  className="h-full rounded-full bg-stone-700 dark:bg-stone-400"
                  style={{ width: `${displayBook.progress}%` }}
                />
              </div>
              <span className="shrink-0 text-xs tabular-nums text-stone-500">{Math.round(displayBook.progress ?? 0)}%</span>
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
            <div className="flex items-center gap-1">
              <ActionIcon label={_('library.edit')} onClick={onEdit}>
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </ActionIcon>
              <div ref={downloadAnchorRef} className="relative">
                <ActionIcon
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
              </div>
              <ActionIcon label={_('library.delete')} danger onClick={() => onDelete(book)}>
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
              </ActionIcon>
            </div>
          </div>
        </div>
      </div>

      {bookmeta?.description && (
        <section className="mt-6">
          <GroupLabel>{_('library.descriptionSection')}</GroupLabel>
          <p className="max-h-40 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-600 dark:text-stone-300">
            {bookmeta.description}
          </p>
        </section>
      )}

      <section className="mt-6">
        <GroupLabel>{_('library.metaSection')}</GroupLabel>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {metaRows.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="text-xs text-stone-400 dark:text-stone-500">{row.label}</dt>
              {row.copyable ? (
                <dd className="mt-0.5">
                  <button
                    type="button"
                    title={row.value}
                    onClick={() => void copyText(row.value)}
                    className="break-all font-mono text-sm text-stone-700 transition-colors hover:text-stone-900 dark:text-stone-200 dark:hover:text-stone-100"
                  >
                    {middleTruncate(row.value)}
                  </button>
                </dd>
              ) : row.onClick ? (
                <dd className="mt-0.5">
                  <button
                    type="button"
                    title={row.value}
                    onClick={row.onClick}
                    className="break-words text-left text-sm text-stone-700 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-200 dark:decoration-stone-600 dark:hover:text-stone-100"
                  >
                    {row.value}
                  </button>
                </dd>
              ) : (
                <dd className="mt-0.5 break-words text-sm text-stone-700 dark:text-stone-200">{row.value}</dd>
              )}
            </div>
          ))}
        </dl>
      </section>
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
