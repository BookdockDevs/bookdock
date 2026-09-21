import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { BookDetailRes, AnnotationRes } from '@bookdock/shared'
import { useQuery } from '@tanstack/react-query'

import { apiGet } from '@/api/client'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import {
  buildAnnotationExport,
  type AnnotationExportFormat,
  type AnnotationExportLabels,
  type AnnotationExportOptions,
} from '../lib/annotation-export'
import { compareCfiPosition } from '../lib/cfi-overlap'
import { buildChapterOrderLookup, type ChapterOrderItem } from '../lib/chapter-order'
import { COLOR_LABEL_KEYS, STYLE_LABEL_KEYS } from './annotation-colors'
import { CheckIcon, ChevronDownIcon, CopyIcon, DocumentExportIcon } from './annotation-icons'

const STORAGE_KEY = 'bd-annotation-export-options'
const LAST_FORMAT_KEY = 'bd-annotation-export-last-format'

function loadOptions(): AnnotationExportOptions {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AnnotationExportOptions>
    return {
      includeDetails: parsed.includeDetails === true,
      includeTime: parsed.includeTime !== false,
      includeDeepLink: parsed.includeDeepLink !== false,
    }
  } catch {
    return { includeDetails: false, includeTime: true, includeDeepLink: true }
  }
}

function saveOptions(options: AnnotationExportOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
  } catch {
    /* storage is optional */
  }
}

function loadLastFormat(): AnnotationExportFormat {
  try {
    const format = localStorage.getItem(LAST_FORMAT_KEY)
    return format === 'text' || format === 'csv' || format === 'markdown' ? format : 'markdown'
  } catch {
    return 'markdown'
  }
}

function download(content: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')
}

interface AnnotationExportDialogProps {
  bookId: string
  annotations: AnnotationRes[]
  sort: 'chapter' | 'chapter-desc' | 'time-desc' | 'time-asc'
  chapterOrder: ChapterOrderItem[]
  onClose: () => void
  quickExport?: boolean
}

export default function AnnotationExportDialog({
  bookId,
  annotations,
  sort,
  chapterOrder,
  onClose,
  quickExport = false,
}: AnnotationExportDialogProps) {
  const _ = useTranslation()
  const [options, setOptions] = useState<AnnotationExportOptions>(loadOptions)
  const [format, setFormat] = useState<AnnotationExportFormat>(loadLastFormat)
  const [previewOpen, setPreviewOpen] = useState(true)
  const [previewCopied, setPreviewCopied] = useState(false)
  const quickExported = useRef(false)

  const bookQuery = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => apiGet<{ data: BookDetailRes }>(`/books/${bookId}`),
  })
  const { data } = bookQuery
  const book = data?.data

  const ordered = useMemo(() => {
    const next = [...annotations]
    if (sort === 'time-desc') return next.sort((a, b) => b.createdAt - a.createdAt)
    if (sort === 'time-asc') return next.sort((a, b) => a.createdAt - b.createdAt)
    const reverse = sort === 'chapter-desc'
    const lookupChapter = buildChapterOrderLookup(chapterOrder)
    return next.sort((a, b) => {
      const aIndex = lookupChapter(a.chapter, a.chapterHref)
      const bIndex = lookupChapter(b.chapter, b.chapterHref)
      const aUnknown = aIndex < 0
      const bUnknown = bIndex < 0
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1
      if (aIndex !== bIndex) return (reverse ? -1 : 1) * (aIndex - bIndex)
      return (reverse ? -1 : 1) * (
        compareCfiPosition(a.cfiRange, b.cfiRange)
        || compareCfiPosition(a.cfiRange, b.cfiRange, true)
        || a.createdAt - b.createdAt
        || a.id.localeCompare(b.id)
      )
    })
  }, [annotations, chapterOrder, sort])

  const bookInfo = useMemo(() => (book ? { id: book.id, title: book.title, author: book.author } : null), [book])
  const exportOptions = useMemo(
    () => ({ ...options, groupByChapter: sort === 'chapter' || sort === 'chapter-desc' }),
    [options, sort],
  )
  const exportLabels: AnnotationExportLabels = useMemo(
    () => ({
      author: _('annotation.exportAuthor'),
      bookmark: _('annotation.bookmark'),
      highlight: _('annotation.drawHighlight'),
      idea: _('annotation.idea'),
      unnamedBookmark: _('annotation.exportUnnamedBookmark'),
      separator: _('annotation.exportLabelSeparator'),
      recordedAt: _('annotation.exportTime'),
      openInBook: _('annotation.exportOpenLink'),
      color: (color) => (COLOR_LABEL_KEYS[color] ? _(COLOR_LABEL_KEYS[color]) : color),
      style: (style) => (STYLE_LABEL_KEYS[style] ? _(STYLE_LABEL_KEYS[style]) : style),
    }),
    [_],
  )

  const preview = useMemo(() => {
    if (!bookInfo) return ''
    return buildAnnotationExport(format, ordered.slice(0, 3), bookInfo, exportOptions, exportLabels)
  }, [bookInfo, format, ordered, exportOptions, exportLabels])

  function updateOptions(patch: Partial<AnnotationExportOptions>) {
    const next = { ...options, ...patch }
    setOptions(next)
    saveOptions(next)
  }

  function selectFormat(fmt: AnnotationExportFormat) {
    setFormat(fmt)
    try {
      localStorage.setItem(LAST_FORMAT_KEY, fmt)
    } catch {
      /* storage is optional */
    }
  }

  const output = useCallback(
    (mode: 'copy' | 'download') => {
      if (!bookInfo) return
      const content = buildAnnotationExport(format, ordered, bookInfo, exportOptions, exportLabels)
      if (mode === 'copy') {
        void navigator.clipboard.writeText(content).then(
          () =>
            notify.success({
              key: 'annotation.exportCopied',
              params: { n: ordered.length, format: format.toUpperCase() },
            }),
          () => notify.error({ key: 'reader.copyFailed' }),
        )
      } else {
        const extension = format === 'markdown' ? 'md' : format === 'text' ? 'txt' : 'csv'
        const filename = _('annotation.exportFilename', {
          title: bookInfo.title,
          n: ordered.length,
          timestamp: exportTimestamp(),
        })
          .replace(/[\\/:*?"<>|]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
        download(
          content,
          `${filename || _('annotation.exportFilenameFallback')}.${extension}`,
          format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
        )
        notify.success({
          key: 'annotation.exportDownloaded',
          params: { n: ordered.length, format: format.toUpperCase() },
        })
      }
    },
    [_, bookInfo, exportLabels, exportOptions, format, ordered],
  )

  function handleCopyPreview() {
    if (!preview) return
    void navigator.clipboard.writeText(preview).then(
      () => {
        setPreviewCopied(true)
        setTimeout(() => setPreviewCopied(false), 1500)
      },
      () => notify.error({ key: 'reader.copyFailed' }),
    )
  }

  useEffect(() => {
    if (quickExport && bookInfo && !quickExported.current) {
      quickExported.current = true
      output('download')
      onClose()
    }
  }, [bookInfo, onClose, output, quickExport])

  const formatExt = format === 'markdown' ? '.md' : format === 'csv' ? '.csv' : '.txt'

  return (
    <Modal title={_('annotation.exportTitle')} onClose={onClose} variant="reader">
      <div className="space-y-4 text-sm">
        {bookQuery.isError ? (
          <QueryErrorState
            className="py-6 text-[var(--bd-read-sub)]"
            isRetrying={bookQuery.isFetching}
            onRetry={bookQuery.refetch}
          />
        ) : (
          <>
            {/* Book context & selected count banner */}
            <div className="flex items-center justify-between rounded-xl bg-stone-500/[0.06] px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-1.5 min-w-0 pr-2">
                <span className="font-semibold text-current truncate">{book?.title || _('reader.notes')}</span>
                {book?.author && <span className="text-[var(--bd-read-sub)] truncate shrink-0">({book.author})</span>}
              </div>
              <span className="shrink-0 font-medium tabular-nums text-[var(--bd-read-primary)]">
                {_('annotation.exportSelected', { n: ordered.length })}
              </span>
            </div>

            {/* Format selection */}
            <div>
              <div className="mb-1.5 text-xs font-medium text-[var(--bd-read-sub)]">
                {_('annotation.exportFormat')}
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-stone-500/[0.06] p-1">
                {[
                  { id: 'markdown' as const, label: 'Markdown', ext: '.md' },
                  { id: 'text' as const, label: _('annotation.exportText'), ext: '.txt' },
                  { id: 'csv' as const, label: _('annotation.exportCsv'), ext: '.csv' },
                ].map((item) => {
                  const active = format === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectFormat(item.id)}
                      className={cn(
                        'flex flex-col items-center justify-center rounded-lg py-1.5 text-xs transition-all',
                        active
                          ? 'bg-[var(--bd-read-bg)] text-current font-medium shadow-xs border border-[var(--bd-read-accent)]/60'
                          : 'text-[var(--bd-read-sub)] hover:text-current hover:bg-stone-500/5',
                      )}
                    >
                      <span>{item.label}</span>
                      <span className="text-[10px] opacity-60 font-mono">{item.ext}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Fields toggles */}
            <div>
              <div className="mb-1.5 text-xs font-medium text-[var(--bd-read-sub)]">
                {_('annotation.exportFields')}
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'includeTime' as const, label: _('annotation.exportTime'), active: options.includeTime },
                  { key: 'includeDeepLink' as const, label: _('annotation.exportLink'), active: options.includeDeepLink },
                  { key: 'includeDetails' as const, label: _('annotation.exportDetails'), active: options.includeDetails },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={item.active}
                    onClick={() => updateOptions({ [item.key]: !item.active })}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all select-none',
                      item.active
                        ? 'border-[var(--bd-read-primary)]/50 bg-[var(--bd-read-primary)]/[0.08] text-[var(--bd-read-primary)] font-medium'
                        : 'border-stone-200/70 bg-transparent text-[var(--bd-read-sub)] hover:border-stone-300 dark:border-stone-800/80 dark:hover:border-stone-700',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-3.5 w-3.5 items-center justify-center rounded-xs border transition-colors',
                        item.active
                          ? 'border-[var(--bd-read-primary)] bg-[var(--bd-read-primary)] text-[var(--bd-read-bg)]'
                          : 'border-[var(--bd-read-sub)]/40 bg-transparent',
                      )}
                    >
                      {item.active && <CheckIcon size={10} strokeWidth={2.6} />}
                    </span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Live preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-[var(--bd-read-sub)]">
                <button
                  type="button"
                  onClick={() => setPreviewOpen((v) => !v)}
                  className="flex items-center gap-1.5 hover:text-current transition-colors select-none"
                >
                  <span className="font-medium text-current">{_('annotation.exportPreview')}</span>
                  <span className="opacity-70">
                    · {_('annotation.exportPreviewFormat', {
                      format: format === 'markdown' ? 'Markdown' : format === 'csv' ? 'CSV' : _('annotation.exportText'),
                      n: Math.min(3, ordered.length),
                    })}
                  </span>
                  <ChevronDownIcon
                    size={14}
                    className={cn('transition-transform duration-150', previewOpen ? 'rotate-180' : '')}
                  />
                </button>
                {previewOpen && (
                  <button
                    type="button"
                    onClick={handleCopyPreview}
                    className="flex items-center gap-1 text-[11px] text-[var(--bd-read-sub)] hover:text-current transition-colors"
                  >
                    <CopyIcon size={12} />
                    <span>{previewCopied ? _('reader.copied') : _('annotation.copy')}</span>
                  </button>
                )}
              </div>
              {previewOpen && (
                <pre
                  className="max-h-36 overflow-auto whitespace-pre-wrap rounded-xl border border-stone-200/60 p-3 text-xs leading-relaxed text-current font-mono select-text custom-scrollbar dark:border-stone-800/60"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--bd-read-bg) 92%, var(--bd-read-text) 8%)' }}
                >
                  {preview}
                </pre>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[var(--bd-read-accent)]/50">
              <button
                type="button"
                onClick={() => output('copy')}
                disabled={!bookInfo}
                className="flex items-center gap-1.5 rounded-xl border border-stone-200/80 bg-transparent px-3.5 py-2 text-xs font-medium text-current hover:bg-stone-500/10 active:scale-98 disabled:opacity-40 transition-all dark:border-stone-800"
              >
                <CopyIcon size={14} />
                <span>{_('annotation.exportCopy')}</span>
              </button>
              <button
                type="button"
                onClick={() => output('download')}
                disabled={!bookInfo}
                className="flex items-center gap-1.5 rounded-xl bg-[var(--bd-read-text)] px-4 py-2 text-xs font-medium text-[var(--bd-read-bg)] hover:opacity-85 active:scale-98 disabled:opacity-40 transition-all shadow-xs"
              >
                <DocumentExportIcon size={14} />
                <span>{_('annotation.exportDownload')} ({formatExt})</span>
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
