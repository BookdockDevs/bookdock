import { useEffect, useState } from 'react'

import type { ReadingDetailManualItem, ReadingSessionUpdateReq } from '@bookdock/shared'

import { useDeleteSession, useReadingDetailInfinite, useUpdateSession } from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'

import AddRecordDialog from './AddRecordDialog'
import SessionEditRow from './SessionEditRow'

function formatClock(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

interface ReadingDetailListProps {
  bookId: string
}

/**
 * Mixed per-book detail feed (09-reading-data.md §5 v2): manual session rows
 * (editable/deletable; retroactive entries with a null startedAt show only
 * the date) merged newest-first with read-only auto-mode day rows, plus the
 * retroactive-entry ("补录") dialog. Edits and deletes touch sessions + daily
 * aggregates only — read progress (intervals union) is intentionally not
 * adjusted, which the edit form states.
 */
export default function ReadingDetailList({ bookId }: ReadingDetailListProps) {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const detail = useReadingDetailInfinite(bookId)
  const updateSession = useUpdateSession()
  const deleteSession = useDeleteSession()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)

  useEffect(() => {
    if (!menu) return
    function handle(e: Event) {
      if (!document.getElementById('reading-detail-menu')?.contains(e.target as Node)) {
        setMenu(null)
      }
    }
    // Clicks inside the foliate iframe never reach document; the renderer
    // relays them as a bubbling `content-click` on the reader container
    document.addEventListener('mousedown', handle)
    document.addEventListener('content-click', handle)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('content-click', handle)
    }
  }, [menu])

  const handleDelete = (id: string) => {
    if (!window.confirm(_('reader.sessionDeleteConfirm'))) return
    deleteSession.mutate(id, {
      onSuccess: () => addToast(_('reader.sessionDeleted'), 'success'),
      onError: toastError,
    })
  }

  const toastError = (err: unknown) => {
    const message = err instanceof Error && err.message ? err.message : _('reader.sessionActionFailed')
    addToast(message, 'error')
  }

  // Global ordinal (index + 1), not chapter titles: novels with volumes restart
  // chapter numbering per volume, so titles are ambiguous — the ordinal is not
  const chapterLabel = (index: number | null): string | null =>
    index === null ? null : _('reader.chapterOrdinal', { n: index + 1 })

  const rangeText = (s: ReadingDetailManualItem): string => {
    if (s.startFraction === null || s.endFraction === null) return '—'
    const startLabel = chapterLabel(s.startChapterIndex)
    const endLabel = chapterLabel(s.endChapterIndex)
    const start = `${startLabel !== null ? `${startLabel} ` : ''}${Math.round(s.startFraction * 100)}%`
    const end = `${endLabel !== null ? `${endLabel} ` : ''}${Math.round(s.endFraction * 100)}%`
    return `${start} → ${end}`
  }

  const items = detail.data?.pages.flatMap((p) => p.data) ?? []

  return (
    <div className="mt-4 border-t border-[var(--bd-read-accent)] pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-[var(--bd-read-sub)]">{_('reader.detailRecords')}</h3>
        <button
          onClick={() => setAddOpen(true)}
          title={_('reader.detailAdd')}
          className="flex h-5 w-5 items-center justify-center rounded-md border border-[var(--bd-read-accent)] text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-[var(--bd-read-text)]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-3.5 w-3.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) =>
          item.kind === 'autoDay' ? (
            <li
              key={`auto-${item.date}`}
              className="rounded-lg border border-[var(--bd-read-accent)] px-2.5 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[var(--bd-read-text)]">
                  {item.date} · {formatDuration(item.durationSeconds)}
                </p>
                <span className="shrink-0 rounded-full bg-stone-500/10 px-1.5 py-0.5 text-[10px] text-[var(--bd-read-sub)]">
                  {_('reader.detailAutoBadge')}
                </span>
              </div>
            </li>
          ) : (
            <li
              key={item.id}
              onContextMenu={(e) => {
                if (editingId === item.id) return
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, id: item.id })
              }}
              className="rounded-lg border border-[var(--bd-read-accent)] px-2.5 py-2 text-xs"
            >
              {editingId === item.id ? (
                <SessionEditRow
                  session={item}
                  onCancel={() => setEditingId(null)}
                  onSave={(body: ReadingSessionUpdateReq) => {
                    updateSession.mutate({ id: item.id, body }, {
                      onSuccess: () => {
                        addToast(_('reader.sessionUpdated'), 'success')
                        setEditingId(null)
                      },
                      onError: toastError,
                    })
                  }}
                />
              ) : (
                <div className="min-w-0">
                  <p className="truncate text-[var(--bd-read-text)]">
                    {item.startedAt !== null ? formatClock(item.startedAt) : item.date} · {formatDuration(item.durationSeconds)}
                  </p>
                  <p className="truncate text-[var(--bd-read-sub)]">{rangeText(item)}</p>
                </div>
              )}
            </li>
          ),
        )}
      </ul>
      {detail.hasNextPage && (
        <button
          onClick={() => detail.fetchNextPage()}
          className="mt-2 w-full rounded-lg border border-[var(--bd-read-accent)] py-1.5 text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-[var(--bd-read-text)]"
        >
          {_('reader.sessionLoadMore')}
        </button>
      )}
      {addOpen && <AddRecordDialog bookId={bookId} onClose={() => setAddOpen(false)} />}
      {menu && (
        <div
          id="reading-detail-menu"
          className="fixed z-[60] min-w-[9rem] rounded-lg border border-stone-200/60 bg-[var(--bd-read-bg)] py-1 shadow-xl dark:border-stone-800/60"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            onClick={() => { setEditingId(menu.id); setMenu(null) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-stone-500/5"
          >
            <span className="text-[var(--bd-read-sub)] [&>svg]:h-4 [&>svg]:w-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </span>
            {_('reader.sessionEdit')}
          </button>
          <button
            onClick={() => { handleDelete(menu.id); setMenu(null) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-500/5"
          >
            <span className="[&>svg]:h-4 [&>svg]:w-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </span>
            {_('reader.sessionDelete')}
          </button>
        </div>
      )}
    </div>
  )
}
