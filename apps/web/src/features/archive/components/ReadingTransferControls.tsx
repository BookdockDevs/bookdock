import { useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import type { ReadingTransfer, ReadingTransferPreview } from '@bookdock/shared'
import { readingTransferSchema } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost } from '@/api/client'
import { READING_RECORDS_KEY } from '@/api/hooks/reading-records'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

interface ReadingTransferControlsProps {
  bookId?: string
  className?: string
  onDeleteArchive?: () => void
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ReadingTransferControls({
  bookId,
  className,
  onDeleteArchive,
}: ReadingTransferControlsProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transfer, setTransfer] = useState<{ body: ReadingTransfer; preview: ReadingTransferPreview } | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmBusy, setDeleteConfirmBusy] = useState(false)

  async function exportData(csv: boolean) {
    setBusy(true)
    setError(null)
    try {
      const result = await apiGet<{ data: ReadingTransfer }>(
        `/reading-records/transfer${bookId ? `?bookId=${encodeURIComponent(bookId)}` : ''}`,
      )
      const name = `reading-${bookId ?? 'all'}`
      if (!csv) {
        download(`${name}.json`, JSON.stringify(result.data, null, 2), 'application/json')
      } else {
        const cell = (value: unknown) => {
          const raw = String(value ?? '')
          const text = /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw
          return `"${text.replaceAll('"', '""')}"`
        }
        const rows = [
          [
            'bookId',
            'title',
            'id',
            'round',
            'source',
            'date',
            'durationSeconds',
            'startedAt',
            'endedAt',
            'startFraction',
            'endFraction',
            'timezone',
          ],
          ...result.data.archives.flatMap((archive) =>
            archive.sessions.map((s) => [
              archive.bookId,
              archive.title,
              s.id,
              s.roundId,
              s.source,
              s.date,
              s.durationSeconds,
              s.startedAt,
              s.endedAt,
              s.startFraction,
              s.endFraction,
              s.timezone,
            ]),
          ),
        ]
        download(`${name}.csv`, rows.map((row) => row.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8')
      }
    } catch (err) {
      setError(getUserErrorMessage(err, _, 'reader.sessionActionFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function previewImport(file: File) {
    setBusy(true)
    setError(null)
    try {
      const body = readingTransferSchema.parse(JSON.parse(await file.text()))
      const result = await apiPost<{ data: ReadingTransferPreview }>('/reading-records/transfer/preview', body)
      setTransfer({ body, preview: result.data })
    } catch (err) {
      setError(getUserErrorMessage(err, _, 'readingData.invalidImport'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {/* 1. 完整导出 (JSON) */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-stone-200/80 bg-stone-50/50 p-3 transition-colors hover:bg-stone-50 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800 dark:bg-stone-800/40 dark:hover:bg-stone-800/60">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M12 18v-6" />
              <path d="m9 15 3 3 3-3" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-stone-800 dark:text-stone-200">
              {bookId ? _('readingData.bookExportJsonTitle', { defaultValue: '本书数据备份 (JSON)' }) : _('readingData.exportJsonTitle')}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
              {bookId ? _('readingData.bookExportJsonDesc', { defaultValue: '导出包含本书阅读记录与阅读进度的完整备份' }) : _('readingData.exportJsonDesc')}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || deleteConfirmBusy}
          onClick={() => void exportData(false)}
          aria-label={_('readingData.exportJson')}
          className="self-end sm:self-center shrink-0 cursor-pointer"
        >
          {_('readingData.exportAction')}
        </Button>
      </div>

      {/* 2. 导出记录 (CSV) */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-stone-200/80 bg-stone-50/50 p-3 transition-colors hover:bg-stone-50 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800 dark:bg-stone-800/40 dark:hover:bg-stone-800/60">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M8 13h8" />
              <path d="M8 17h8" />
              <path d="M10 9h4" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-stone-800 dark:text-stone-200">
              {bookId ? _('readingData.bookExportCsvTitle', { defaultValue: '本书记录明细 (CSV)' }) : _('readingData.exportCsvTitle')}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
              {bookId ? _('readingData.bookExportCsvDesc', { defaultValue: '导出本书的阅读明细流水，适合在表格工具中分析' }) : _('readingData.exportCsvDesc')}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || deleteConfirmBusy}
          onClick={() => void exportData(true)}
          aria-label={_('readingData.exportCsv')}
          className="self-end sm:self-center shrink-0 cursor-pointer"
        >
          {_('readingData.exportAction')}
        </Button>
      </div>

      {/* 3. 恢复归档 (JSON) */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-stone-200/80 bg-stone-50/50 p-3 transition-colors hover:bg-stone-50 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800 dark:bg-stone-800/40 dark:hover:bg-stone-800/60">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-stone-800 dark:text-stone-200">
              {_('readingData.importJsonTitle')}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
              {_('readingData.importJsonDesc')}
            </p>
          </div>
        </div>
        <label
          className={cn(
            'relative inline-flex h-8 shrink-0 items-center justify-center rounded-xl px-3 text-xs font-medium transition-colors cursor-pointer self-end sm:self-center',
            'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700',
            (busy || deleteConfirmBusy) && 'opacity-40 cursor-not-allowed',
          )}
        >
          <span>{_('readingData.importAction')}</span>
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy || deleteConfirmBusy}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void previewImport(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {/* 4. 删除本书个人阅读档案 (仅单书时展示) */}
      {bookId && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-red-200/70 bg-red-50/30 p-3 transition-colors hover:bg-red-50/50 sm:flex-row sm:items-center sm:justify-between dark:border-red-950/60 dark:bg-red-950/20 dark:hover:bg-red-950/30">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                {_('readingData.deleteArchive')}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
                {_('readingData.deleteArchiveDesc')}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="danger"
            disabled={busy || deleteConfirmBusy}
            onClick={() => setDeleteConfirmOpen(true)}
            aria-label={_('readingData.deleteArchive')}
            className="self-end sm:self-center shrink-0 cursor-pointer"
          >
            {_('reader.sessionDelete')}
          </Button>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {transfer && (
        <ConfirmDialog
          title={_('readingData.importJson')}
          message={_('readingData.importPreview', {
            archives: transfer.preview.archives,
            sessions: transfer.preview.sessions,
            duplicates: transfer.preview.duplicates,
          })}
          confirmLabel={_('readingData.importConfirm')}
          confirmVariant="primary"
          errorFallback="reader.sessionActionFailed"
          confirmDisabled={busy}
          onClose={() => {
            if (!busy) setTransfer(null)
          }}
          onConfirm={async () => {
            setBusy(true)
            try {
              await apiPost('/reading-records/transfer/import', transfer.body)
              setTransfer(null)
              void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
              void queryClient.invalidateQueries({ queryKey: ['archive'] })
            } finally {
              setBusy(false)
            }
          }}
        />
      )}

      {deleteConfirmOpen && (
        <ConfirmDialog
          title={_('readingData.deleteArchive')}
          message={_('readingData.deleteArchiveConfirm')}
          confirmLabel={_('reader.sessionDelete')}
          errorFallback="reader.sessionActionFailed"
          confirmDisabled={deleteConfirmBusy}
          onClose={() => {
            if (!deleteConfirmBusy) setDeleteConfirmOpen(false)
          }}
          onConfirm={async () => {
            if (!bookId) return
            setDeleteConfirmBusy(true)
            try {
              await apiDelete(`/reading-records/book/${encodeURIComponent(bookId)}/ledger`)
              void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
              void queryClient.invalidateQueries({ queryKey: ['archive'] })
              setDeleteConfirmOpen(false)
              onDeleteArchive?.()
            } finally {
              setDeleteConfirmBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}
