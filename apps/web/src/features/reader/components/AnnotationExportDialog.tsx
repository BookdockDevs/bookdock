import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { BookDetailRes, AnnotationRes } from '@bookdock/shared'
import { useQuery } from '@tanstack/react-query'

import { apiGet } from '@/api/client'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'

import {
  buildAnnotationExport,
  type AnnotationExportFormat,
  type AnnotationExportLabels,
  type AnnotationExportOptions,
} from '../lib/annotation-export'
import { COLOR_LABEL_KEYS, STYLE_LABEL_KEYS } from './annotation-colors'

const STORAGE_KEY = 'bd-annotation-export-options'
const LAST_FORMAT_KEY = 'bd-annotation-export-last-format'

function loadOptions(): AnnotationExportOptions {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AnnotationExportOptions>
    return {
      includeDetails: parsed.includeDetails === true,
      includeTime: parsed.includeTime === true,
      includeDeepLink: parsed.includeDeepLink !== false,
    }
  } catch {
    return { includeDetails: false, includeTime: false, includeDeepLink: true }
  }
}

function saveOptions(options: AnnotationExportOptions): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(options)) } catch { /* storage is optional */ }
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
  chapterOrder: string[]
  onClose: () => void
  quickExport?: boolean
}

export default function AnnotationExportDialog({ bookId, annotations, sort, chapterOrder, onClose, quickExport = false }: AnnotationExportDialogProps) {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const [options, setOptions] = useState<AnnotationExportOptions>(loadOptions)
  const [openMenu, setOpenMenu] = useState<'copy' | 'download' | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const quickExported = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const { data } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => apiGet<{ data: BookDetailRes }>(`/books/${bookId}`),
  })
  const book = data?.data
  const ordered = useMemo(() => {
    const next = [...annotations]
    if (sort === 'time-desc') return next.sort((a, b) => b.createdAt - a.createdAt)
    if (sort === 'time-asc') return next.sort((a, b) => a.createdAt - b.createdAt)
    const reverse = sort === 'chapter-desc'
    const chapterIndex = (chapter: string | null) => chapter ? chapterOrder.indexOf(chapter) : -1
    return next.sort((a, b) => {
      const aIndex = chapterIndex(a.chapter)
      const bIndex = chapterIndex(b.chapter)
      const aUnknown = aIndex < 0
      const bUnknown = bIndex < 0
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1
      if (aIndex !== bIndex) return (reverse ? -1 : 1) * (aIndex - bIndex)
      return (reverse ? -1 : 1) * a.cfiRange.localeCompare(b.cfiRange)
    })
  }, [annotations, chapterOrder, sort])
  const bookInfo = useMemo(() => (book ? { id: book.id, title: book.title, author: book.author } : null), [book])
  const exportOptions = useMemo(() => ({ ...options, groupByChapter: sort === 'chapter' || sort === 'chapter-desc' }), [options, sort])
  const exportLabels: AnnotationExportLabels = useMemo(() => ({
    author: _('annotation.exportAuthor'),
    bookmark: _('annotation.bookmark'),
    highlight: _('annotation.drawHighlight'),
    idea: _('annotation.idea'),
    unnamedBookmark: _('annotation.exportUnnamedBookmark'),
    separator: _('annotation.exportLabelSeparator'),
    recordedAt: _('annotation.exportTime'),
    openInBook: _('annotation.exportOpenLink'),
    color: (color) => COLOR_LABEL_KEYS[color] ? _(COLOR_LABEL_KEYS[color]) : color,
    style: (style) => STYLE_LABEL_KEYS[style] ? _(STYLE_LABEL_KEYS[style]) : style,
  }), [_])
  const preview = bookInfo ? buildAnnotationExport('markdown', ordered.slice(0, 3), bookInfo, exportOptions, exportLabels) : ''

  function updateOptions(patch: Partial<AnnotationExportOptions>) {
    const next = { ...options, ...patch }
    setOptions(next)
    saveOptions(next)
  }

  const output = useCallback((format: AnnotationExportFormat, mode: 'copy' | 'download') => {
    if (!bookInfo) return
    try { localStorage.setItem(LAST_FORMAT_KEY, format) } catch { /* storage is optional */ }
    const content = buildAnnotationExport(format, ordered, bookInfo, exportOptions, exportLabels)
    if (mode === 'copy') {
      void navigator.clipboard.writeText(content).then(
        () => addToast(_('annotation.exportCopied', { n: ordered.length, format: format.toUpperCase() }), 'success'),
        () => addToast(_('reader.copyFailed'), 'error'),
      )
    } else {
      const extension = format === 'markdown' ? 'md' : format === 'text' ? 'txt' : 'csv'
      const filename = _('annotation.exportFilename', {
        title: bookInfo.title,
        n: ordered.length,
        timestamp: exportTimestamp(),
      }).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
      download(content, `${filename || _('annotation.exportFilenameFallback')}.${extension}`, format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8')
      addToast(_('annotation.exportDownloaded', { n: ordered.length, format: format.toUpperCase() }), 'success')
    }
    setOpenMenu(null)
    setMenuPosition(null)
  }, [_, addToast, bookInfo, exportLabels, exportOptions, ordered])

  useEffect(() => {
    if (quickExport && bookInfo && !quickExported.current) {
      quickExported.current = true
      output(loadLastFormat(), 'download')
      onClose()
    }
  }, [bookInfo, onClose, output, quickExport])

  useEffect(() => {
    if (!openMenu) return
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) {
        setOpenMenu(null)
        setMenuPosition(null)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenMenu(null)
        setMenuPosition(null)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenu])

  const actionMenu = (mode: 'copy' | 'download') => {
    const formats: AnnotationExportFormat[] = mode === 'copy' ? ['markdown', 'text'] : ['markdown', 'text', 'csv']
    return openMenu === mode && menuPosition && createPortal(
    <div ref={menuRef} onPointerDown={(e) => e.stopPropagation()} className="fixed z-[70] w-32 overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1 shadow-xl" style={menuPosition}>
      {formats.map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => output(format, mode)}
          className="block h-9 w-full rounded-lg px-3 text-left text-xs text-[var(--bd-read-text)] transition-colors hover:bg-[var(--bd-read-page-bg)]"
        >
          {format === 'markdown' ? _('annotation.exportMarkdown') : format === 'text' ? _('annotation.exportText') : _('annotation.exportCsv')}
        </button>
      ))}
    </div>,
    document.body,
    )
  }

  return (
    <Modal title={_('annotation.exportTitle')} onClose={onClose} variant="reader">
      <div onClick={() => setOpenMenu(null)} className="space-y-4 text-sm">
        <p className="text-xs text-[var(--bd-read-sub)]">{_('annotation.exportSelected', { n: ordered.length })}</p>
        <div>
          <div className="mb-2 text-xs text-[var(--bd-read-sub)]">{_('annotation.exportExtra')}</div>
          <div className="flex flex-wrap gap-2">
            {[ 
              { key: 'includeDetails' as const, label: _('annotation.exportDetails'), active: options.includeDetails },
              { key: 'includeTime' as const, label: _('annotation.exportTime'), active: options.includeTime },
              { key: 'includeDeepLink' as const, label: _('annotation.exportLink'), active: options.includeDeepLink },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={item.active}
                onClick={() => updateOptions({ [item.key]: !item.active })}
                className={`h-10 min-w-28 rounded-lg border px-3 text-xs transition-colors ${item.active ? 'border-current bg-current/10 text-current' : 'border-[var(--bd-read-accent)] text-[var(--bd-read-sub)] hover:bg-[var(--bd-read-page-bg)]'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={(e) => { e.stopPropagation(); setPreviewOpen((v) => !v) }} className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-xs text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)]">
          <span>{_('annotation.exportPreview')} · {_('annotation.exportPreviewMarkdown', { n: 3 })}</span><span>{previewOpen ? '⌃' : '⌄'}</span>
        </button>
        {previewOpen && <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--bd-read-accent)] p-3 text-xs leading-relaxed text-[var(--bd-read-text)]" style={{ backgroundColor: 'color-mix(in srgb, var(--bd-read-bg) 90%, var(--bd-read-text) 10%)' }}>{preview}</pre>}
        <div className="flex justify-end gap-2 pt-2">
          <div className="relative">
            <button ref={openMenu === 'copy' ? menuButtonRef : undefined} type="button" disabled={!bookInfo} onClick={(e) => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setMenuPosition({ top: rect.bottom + 8, left: rect.left }); setOpenMenu(openMenu === 'copy' ? null : 'copy') }} className="rounded-lg border border-[var(--bd-read-accent)] px-3 py-2 text-xs hover:bg-[var(--bd-read-page-bg)] disabled:opacity-50">{_('annotation.exportCopy')} ▾</button>
            {actionMenu('copy')}
          </div>
          <div className="relative">
            <button ref={openMenu === 'download' ? menuButtonRef : undefined} type="button" disabled={!bookInfo} onClick={(e) => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setMenuPosition({ top: rect.bottom + 8, left: rect.left }); setOpenMenu(openMenu === 'download' ? null : 'download') }} className="rounded-lg border border-[var(--bd-read-text)] bg-[var(--bd-read-text)] px-3 py-2 text-xs font-medium text-[var(--bd-read-bg)] hover:opacity-85 disabled:opacity-50">{_('annotation.exportDownload')} ▾</button>
            {actionMenu('download')}
          </div>
        </div>
      </div>
    </Modal>
  )
}
