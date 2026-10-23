import { useMemo, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import type { ReadingLedgerSession } from '@bookdock/shared'

import { READING_RECORDS_KEY, useBookReadingLedgerStats, useBookReadingSessions, useDeleteSession, useReadingLedger, useReadingLedgerRecovery } from '@/api/hooks/reading-records'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useBook } from '@/features/library/hooks'
import ReadingSessionCard from '@/features/archive/components/ReadingSessionCard'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

import AddRecordDialog from './AddRecordDialog'

interface StatsPanelProps { bookId: string }

export default function StatsPanel({ bookId }: StatsPanelProps) {
  const _ = useTranslation()
  const ledgerQuery = useReadingLedger(bookId)
  const dataVersion = ledgerQuery.data?.data?.dataVersion
  const statsQuery = useBookReadingLedgerStats(bookId, undefined, dataVersion)
  const sessionsQuery = useBookReadingSessions(bookId, undefined, dataVersion)
  const bookQuery = useBook(bookId)
  const deleteMutation = useDeleteSession()
  const queryClient = useQueryClient()

  const [addOpen, setAddOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<ReadingLedgerSession | null>(null)
  const [deletingSession, setDeletingSession] = useState<ReadingLedgerSession | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)

  const ledger = ledgerQuery.data?.data
  const statsVersionMismatch = Boolean(ledger?.dataVersion !== undefined && statsQuery.data?.data && statsQuery.data.data.dataVersion !== ledger.dataVersion)
  const book = bookQuery.data?.data
  const round = ledger?.rounds.find((item) => item.id === ledger.currentRoundId) ?? ledger?.rounds[0]
  const sessionsVersionStable = useMemo(() => {
    const pages = sessionsQuery.data?.pages ?? []
    const pageVersion = pages[0]?.data.dataVersion
    return pageVersion !== undefined && pages.length > 0 && pages.every((page) => page.data.dataVersion === pageVersion)
      && (dataVersion === undefined || pageVersion === dataVersion)
  }, [dataVersion, sessionsQuery.data])
  const sessionsVersionMismatch = Boolean(dataVersion !== undefined && (sessionsQuery.data?.pages ?? []).length > 0 && !sessionsVersionStable)
  const hasVersionMismatch = statsVersionMismatch || sessionsVersionMismatch

  const recovery = useReadingLedgerRecovery(bookId, hasVersionMismatch)

  const handleRetry = () => {
    if (hasVersionMismatch || recovery.failed) { recovery.retry(); return }
    void ledgerQuery.refetch()
    void statsQuery.refetch()
    void queryClient.resetQueries({ queryKey: [...READING_RECORDS_KEY, 'ledger-sessions', bookId] })
  }
  const stats = statsVersionMismatch ? undefined : statsQuery.data?.data
  const sessions = useMemo(() => {
    const pages = sessionsQuery.data?.pages ?? []
    return sessionsVersionStable ? pages.flatMap((page) => page.data.items) : pages[0]?.data.items ?? []
  }, [sessionsQuery.data, sessionsVersionStable])
  const sortedSessions = sessions
  const visibleSessions = sortedSessions
  const days = stats?.readingDays ?? 0
  const coverage = ledger?.coverage ?? 0
  const ringIntervals = ledger?.coverageIntervals ?? []
  const earliestDate = ledger?.earliestDate ?? null

  function formatPercent(value: number): string {
    const rounded = Number(value.toFixed(2))
    return `${rounded}%`
  }

  const latestProgress = useMemo(() => {
    if (book?.progress != null) {
      return Math.min(100, Math.max(0, book.progress))
    }
    return coverage * 100
  }, [book?.progress, coverage])

  if (ledgerQuery.isError || statsQuery.isError || sessionsQuery.isError) {
    return <QueryErrorState className="text-[var(--bd-read-sub)]" isRetrying={ledgerQuery.isFetching || statsQuery.isFetching || sessionsQuery.isFetching} onRetry={handleRetry} />
  }
  if (hasVersionMismatch && recovery.failed) {
    return <QueryErrorState className="text-[var(--bd-read-sub)]" isRetrying={ledgerQuery.isFetching || statsQuery.isFetching || sessionsQuery.isFetching} onRetry={handleRetry} />
  }
  if (hasVersionMismatch || ledgerQuery.isPending || statsQuery.isPending || sessionsQuery.isPending) return <div role="status" className="h-40 animate-pulse rounded-xl bg-stone-500/10" />

  const totalSeconds = ledger?.totalSeconds ?? 0
  const totalWords = stats?.totalWordsRead
  const totalWordsDisplay = totalWords !== null && totalWords !== undefined && totalWords > 0
    ? totalWords >= 10000
      ? `${(totalWords / 10000).toFixed(2)} 万`
      : totalWords.toLocaleString()
    : '—'
  const avgDailySeconds = days > 0 ? Math.round(totalSeconds / days) : null
  const initialFraction = coverage

  return (
    <div className="space-y-4 px-1 pt-3 pb-6">
      {!ledger?.totalSeconds && (
        <div className="rounded-xl bg-stone-500/5 p-3">
          <p className="text-sm font-semibold text-[var(--bd-read-text)]">{_('reader.statsEmptyTitle')}</p>
          <p className="mt-1 text-xs text-[var(--bd-read-sub)]">{_('reader.statsEmptyDesc')}</p>
        </div>
      )}

      {/* 概览卡片：单书详情同款分段覆盖环形图（居中最新进度）+ 4项核心指标（总时长、已读字数、阅读天数、日均时长） */}
      <section className="rounded-2xl border border-[var(--bd-read-accent)]/80 bg-[var(--bd-read-bg)] p-3.5 shadow-2xs">
        {/* 卡片上半部：左侧分段环形进度圈 + 轮次，右侧总时长与字数 */}
        <div className="flex items-center gap-4">
          {/* 左侧分段覆盖环形图（纯净无多余游标） */}
          <div className="flex flex-col items-center shrink-0">
            <div className="relative flex h-22 w-22 items-center justify-center">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" strokeWidth="8" className="stroke-stone-500/15" fill="none" />
                {ringIntervals.map(([start, end], idx) => {
                  const dash = Math.max(0, (end - start) * 263.8938)
                  const offset = -start * 263.8938
                  return (
                    <circle
                      key={`${start}-${end}-${idx}`}
                      cx="50" cy="50" r="42" strokeWidth="8"
                      strokeDasharray={`${dash} 263.8938`}
                      strokeDashoffset={offset}
                      strokeLinecap="round"
                      className="stroke-emerald-500 transition-all duration-700 ease-out dark:stroke-emerald-400"
                      fill="none"
                    />
                  )
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-sm font-bold tabular-nums tracking-tight text-[var(--bd-read-text)]">
                  {formatPercent(latestProgress)}
                </span>
                <span className="sr-only">
                  {_('reader.statsProgress')}
                </span>
              </div>
            </div>
            <span className="mt-1.5 inline-flex items-center rounded-full bg-stone-500/10 px-2 py-0.5 text-[10px] font-medium text-[var(--bd-read-sub)]">
              {round?.status === 'finished' ? _('readingData.status.finished') : _('readingData.roundOrdinal', { n: round?.ordinal ?? 1 })}
            </span>
          </div>

          {/* 右侧核心数据矩阵：总时长与已读字数 */}
          <div className="flex flex-1 flex-col justify-center gap-2 min-w-0">
            <div>
              <div className="text-xs text-[var(--bd-read-sub)]">{_('reader.statsTotalTime')}</div>
              <div className="mt-0.5 text-base font-bold tabular-nums text-[var(--bd-read-text)] truncate">
                {formatDuration(totalSeconds, _)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--bd-read-sub)]">{_('readingData.words')}</div>
              <div className="mt-0.5 text-base font-bold tabular-nums text-[var(--bd-read-text)] truncate">
                {totalWordsDisplay}
              </div>
            </div>
          </div>
        </div>

        {/* 卡片下半部：细分指标（阅读天数、平均每天时长） */}
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--bd-read-accent)]/50 pt-2.5">
          <div>
            <div className="text-xs text-[var(--bd-read-sub)]">{_('reader.statsReadingDays')}</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--bd-read-text)]">
              <span>{days}</span> <span className="text-xs font-normal text-[var(--bd-read-sub)]">天</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--bd-read-sub)]">{_('readingData.avgDailyDuration')}</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--bd-read-text)] truncate">
              {avgDailySeconds ? formatDuration(avgDailySeconds, _) : (earliestDate ? earliestDate.replace(/-/g, '.') : '—')}
            </div>
          </div>
        </div>
      </section>

      {/* Reading Session Details List */}
      {sortedSessions.length > 0 && (
        <div className="pt-2">
          {/* 明细标题行：左侧标题 + 数量胶囊，右侧 + 补录 胶囊按钮 */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-[var(--bd-read-text)]">{_('reader.detailRecords')}</h3>
              <span className="inline-flex items-center rounded-full bg-stone-500/10 px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--bd-read-sub)]">
                {sortedSessions.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--bd-read-accent)]/80 bg-[var(--bd-read-bg)] px-2.5 py-1 text-xs font-medium text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10 cursor-pointer active:scale-95 shadow-2xs"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>{_('reader.detailAdd')}</span>
            </button>
          </div>
          <div className="flex flex-col gap-2.5">
            {visibleSessions.map((session) => (
              <ReadingSessionCard
                key={session.id}
                session={session}
                totalWordCount={round?.wordCount ?? ledger?.legacyWordCount ?? undefined}
                onEdit={(s) => setEditingSession(s)}
                onDelete={(s) => setDeletingSession(s)}
                variant="reader"
              />
            ))}
          </div>
          {sessionsVersionStable && sessionsQuery.hasNextPage && (
            <button
              type="button"
              onClick={() => void sessionsQuery.fetchNextPage()}
              disabled={sessionsQuery.isFetchingNextPage}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--bd-read-accent)]/80 py-2 text-xs font-medium text-[var(--bd-read-sub)] hover:bg-stone-500/10 cursor-pointer transition-colors"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
              <span>{_('reader.sessionLoadMore')}</span>
            </button>
          )}
        </div>
      )}

      {addOpen && (
        <AddRecordDialog
          bookId={bookId}
          initialStartFraction={initialFraction}
          onClose={() => setAddOpen(false)}
        />
      )}

      {editingSession && (
        <AddRecordDialog
          bookId={bookId}
          variant="reader"
          editingSession={editingSession}
          onClose={() => setEditingSession(null)}
        />
      )}

      {deletingSession && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle')}
          message={_('reader.sessionDeleteConfirm')}
          confirmLabel={_('reader.sessionDelete')}
          confirmDisabled={deletingBusy}
          onClose={() => {
            if (!deletingBusy) setDeletingSession(null)
          }}
          onConfirm={async () => {
            setDeletingBusy(true)
            try {
              await deleteMutation.mutateAsync(deletingSession.id)
              setDeletingSession(null)
            } finally {
              setDeletingBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}
