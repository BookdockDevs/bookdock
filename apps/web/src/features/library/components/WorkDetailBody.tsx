import { useMemo, useRef, useState } from 'react'

import { useNavigate } from '@tanstack/react-router'
import i18n from 'i18next'

import type { CatalogBook, Library } from '@bookdock/shared'

import { useBookReplacements } from '@/api/hooks/useReplacements'
import { Button } from '@/components/ui/Button'
import MenuFlyout from '@/components/ui/MenuFlyout'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { computeFromAnchor, type SmartPosition } from '@/lib/position'
import { formatBytes, formatDate } from '@/lib/utils'

import { catalogWorkRow, rowCover } from '../book-row'
import { copyCover, downloadBook, downloadCover, downloadEditedTxt, downloadEpub, downloadOriginalTxt } from '../download'
import { useCollectBook, useDeleteCatalogVersion, useUpdateCatalogVersion } from '../hooks'
import BookCover from './BookCover'
import CatalogVersionList from './CatalogVersionList'
import { copyText, formatLanguage, isMachineIdentifier, middleTruncate } from './book-detail/types'
import { ActionIcon, FilterChip, GroupLabel } from './book-detail/ui'

/**
 * What a work in a shared library knows about itself, told the way a private
 * book's detail tells it: artwork, title, author, actions, description, facts.
 * What a work cannot have - read status, progress, shelf, personal metadata -
 * is absent rather than stubbed. Versions render below only while there is
 * more than one to choose from; a single version is the work, acted on above.
 */
export default function WorkDetailBody({
  work, library, canManage, canCollect, moveCandidates, onClose,
}: {
  work: CatalogBook
  library: Library
  canManage: boolean
  canCollect: boolean
  moveCandidates: CatalogBook[]
  onClose: () => void
}) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const row = catalogWorkRow(work)
  const first = work.versions[0]
  const collect = useCollectBook()
  const updateVersion = useUpdateCatalogVersion()
  const deleteVersion = useDeleteCatalogVersion()
  const [collected, setCollected] = useState(false)
  const isCollected = collected || first?.collected === true
  const [copyingCover, setCopyingCover] = useState(false)
  const [downloadMenu, setDownloadMenu] = useState<SmartPosition | null>(null)
  const downloadAnchorRef = useRef<HTMLDivElement>(null)
  const downloadMenuRef = useRef<HTMLDivElement>(null)

  const hasCoverImage = Boolean(work.coverKey || first?.format === 'epub')
  const readable = first?.status === 'published'
  const canDownload = canCollect && readable && Boolean(first)

  const { data: replacementsData } = useBookReplacements(first?.bookVersionId)
  const canExportEdited = useMemo(
    () => (replacementsData?.data ?? []).some((r) => (r.effectiveEnabled ?? r.enabled)),
    [replacementsData],
  )

  function goToFilter(search: { author?: string; tag?: string; series?: string }) {
    onClose()
    void navigate({ to: '/', search: { libraryId: library.id, ...search } })
  }

  function readFirst() {
    if (!first) return
    onClose()
    void navigate({ to: '/books/$id', params: { id: first.bookVersionId } })
  }

  async function handleCopyCover() {
    if (!first || copyingCover) return
    setCopyingCover(true)
    try {
      await copyCover(first.bookVersionId)
      notify.success(_('library.coverCopied'))
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.copyCoverFailed'))
    } finally {
      setCopyingCover(false)
    }
  }

  async function handleDownloadCover() {
    if (!first) return
    try {
      await downloadCover(first.bookVersionId, work.title)
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

  async function onExport(format: 'epub' | 'txt', plain: boolean) {
    if (!first) return
    setDownloadMenu(null)
    const title = first.effective.title
    try {
      if (format === 'epub') {
        await downloadEpub(first.bookVersionId, title, { plain })
      } else if (plain) {
        await downloadOriginalTxt(first.bookVersionId, title)
      } else {
        await downloadEditedTxt(first.bookVersionId, title)
      }
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'errors.downloadFailed'))
    }
  }

  function downloadFirst() {
    if (!first) return
    if (first.format === 'txt') {
      toggleDownloadMenu()
      return
    }
    void Promise.resolve(downloadBook(first.bookVersionId, first.effective.title)).catch((err) =>
      notify.error(getUserErrorNotification(err, 'errors.downloadFailed')),
    )
  }

  function togglePublish() {
    if (!first) return
    updateVersion.mutate({
      libraryId: library.id,
      libraryBookId: work.id,
      versionLinkId: first.id,
      patch: { status: first.status === 'unlisted' ? 'published' : 'unlisted' },
    })
  }

  function deleteWork() {
    if (!first) return
    deleteVersion.mutate({ libraryId: library.id, libraryBookId: work.id, versionLinkId: first.id })
  }

  function collectFirst() {
    if (!first) return
    collect.mutate({ libraryId: library.id, versionLinkId: first.id }, {
      onSuccess: (res) => {
        setCollected(true)
        notify[res.data.alreadyExists ? 'info' : 'success'](
          res.data.alreadyExists ? _('library.collectAlready') : _('library.collectSuccess'),
        )
      },
      onError: (err) => notify.error(getUserErrorNotification(err, 'library.collectFailed')),
    })
  }

  const metaRows: { label: string; value: string; copyable?: boolean; onClick?: () => void }[] = []
  const bookmeta = first?.effective.bookmeta
  if (bookmeta?.publisher) metaRows.push({ label: _('library.publisher'), value: bookmeta.publisher })
  if (bookmeta?.published) metaRows.push({ label: _('library.published'), value: bookmeta.published })
  if (bookmeta?.language) {
    metaRows.push({ label: _('library.language'), value: formatLanguage(bookmeta.language, i18n.language) })
  }
  if (first) {
    metaRows.push({ label: _('library.format'), value: first.format.toUpperCase() })
    metaRows.push({ label: _('library.sortBy.size'), value: formatBytes(first.size) })
  }
  if (first?.effective.fileName) {
    metaRows.push({ label: _('library.originalFile'), value: first.effective.fileName, copyable: true })
  }
  metaRows.push({ label: _('library.addedAt'), value: formatDate(work.createdAt) })
  const rawIdentifier = bookmeta?.isbn || bookmeta?.identifier || ''
  if (rawIdentifier && (bookmeta?.isbn || !isMachineIdentifier(rawIdentifier))) {
    metaRows.push({ label: bookmeta?.isbn ? 'ISBN' : _('library.identifier'), value: rawIdentifier, copyable: true })
  }
  if (bookmeta?.subjects?.length) {
    metaRows.push({ label: _('library.subjects'), value: bookmeta.subjects.join('、') })
  }
  if (bookmeta?.series) {
    const series = bookmeta.series
    metaRows.push({
      label: _('library.seriesSection'),
      value: bookmeta.seriesIndex != null ? `${series} #${bookmeta.seriesIndex}` : series,
      onClick: () => goToFilter({ series }),
    })
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
        <div className="group/cover relative w-32 shrink-0 self-center overflow-hidden rounded-xl shadow-md shadow-stone-900/10 sm:self-start">
          <BookCover book={rowCover(row)} coverSrc={row.coverSrc} />
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
            {work.title}
          </h3>
          {work.author ? (
            <button
              type="button"
              onClick={() => goToFilter({ author: work.author })}
              className="mt-1 text-left text-sm text-stone-500 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-400 dark:decoration-stone-600 dark:hover:text-stone-100"
            >
              {work.author}
            </button>
          ) : (
            <p className="mt-1 text-sm text-stone-400 dark:text-stone-500">
              {_('library.unknown')}
            </p>
          )}

          {work.tags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {work.tags.map((tag) => (
                <FilterChip key={tag.id} prefix="#" label={tag.name} onClick={() => goToFilter({ tag: tag.id })} />
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {first && (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!readable}
                title={!readable ? _('library.catalogUnlistedReadHint') : undefined}
                onClick={readFirst}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                {_('library.startReading')}
              </Button>
            )}
            <div className="flex flex-1 items-center gap-1.5">
              {canCollect && first && !isCollected && (
                <Button size="sm" variant="secondary" className="gap-1.5" disabled={collect.isPending} onClick={collectFirst}>
                  {_('library.collect')}
                </Button>
              )}
              {canDownload && (
                <div ref={downloadAnchorRef} className="relative">
                  <ActionIcon
                    secondary
                    label={_('library.download')}
                    onClick={downloadFirst}
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </ActionIcon>
                  {downloadMenu && first?.format === 'txt' && (
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
              )}
              {canManage && first && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={togglePublish}
                >
                  {first.status === 'unlisted' ? _('library.catalogPublish') : _('library.catalogUnlist')}
                </Button>
              )}
              {canManage && first && (
                <div className="ml-auto">
                  <ActionIcon label={_('library.delete')} danger onClick={deleteWork}>
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                  </ActionIcon>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {work.description && (
        <section className="mt-5">
          <GroupLabel>{_('library.descriptionSection')}</GroupLabel>
          <p className="max-h-40 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-600 dark:text-stone-300">
            {work.description}
          </p>
        </section>
      )}

      <section className="mt-5">
        <div className="rounded-xl border border-stone-200/70 bg-stone-50/70 p-3.5 dark:border-stone-800 dark:bg-stone-800/40">
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
                      className="line-clamp-2 break-all font-mono text-sm text-stone-700 transition-colors hover:text-stone-900 dark:text-stone-200 dark:hover:text-stone-100"
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
                      className="line-clamp-2 break-words text-left text-sm text-stone-700 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-200 dark:decoration-stone-600 dark:hover:text-stone-100"
                    >
                      {row.value}
                    </button>
                  </dd>
                ) : (
                  <dd className="mt-0.5 line-clamp-2 break-words text-sm text-stone-700 dark:text-stone-200">{row.value}</dd>
                )}
              </div>
            ))}
          </dl>
        </div>
      </section>

      {work.versions.length > 1 && (
        <ul className="mt-5 flex flex-col gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
          <CatalogVersionList
            work={work}
            library={library}
            canManage={canManage}
            canCollect={canCollect}
            moveCandidates={moveCandidates}
          />
        </ul>
      )}
    </div>
  )
}

function FlyoutChevron({ flip }: { flip: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-stone-400 transition-transform ${flip ? 'rotate-180' : ''}`}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

function ExportFormats({ onPick }: { onPick: (format: 'epub' | 'txt') => void }) {
  const _ = useTranslation()
  return (
    <>
      {(['epub', 'txt'] as const).map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => onPick(format)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-stone-500/10"
        >
          <span className="flex-1">{format === 'epub' ? 'EPUB' : 'TXT'}</span>
        </button>
      ))}
    </>
  )
}
