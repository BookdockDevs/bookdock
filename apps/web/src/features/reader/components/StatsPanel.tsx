import { useMemo, useState } from 'react'

import type { ReadingLedgerSession } from '@bookdock/shared'

import { useDeleteSession, useReadingLedger } from '@/api/hooks/reading-records'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useBook } from '@/features/library/hooks'
import ReadingSessionCard from '@/features/archive/components/ReadingSessionCard'
import { ledgerCoverageByDate, ledgerEstimates, ledgerProgressBounds, ledgerTimeDistribution } from '@/features/archive/components/reading-ledger-stats'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

import AddRecordDialog from './AddRecordDialog'

interface StatsPanelProps { bookId: string }

export default function StatsPanel({ bookId }: StatsPanelProps) {
  const _ = useTranslation()
  const ledgerQuery = useReadingLedger(bookId)
  const bookQuery = useBook(bookId)
  const deleteMutation = useDeleteSession()
  const [addOpen, setAddOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<ReadingLedgerSession | null>(null)
  const [deletingSession, setDeletingSession] = useState<ReadingLedgerSession | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const [recordLimit, setRecordLimit] = useState(20)

  const ledger = ledgerQuery.data?.data
  const book = bookQuery.data?.data
  const round = ledger?.rounds.find((item) => item.id === ledger.currentRoundId) ?? ledger?.rounds[0]
  const sessions = useMemo(() => ledger?.sessions ?? [], [ledger])
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt ?? 0) - (a.startedAt ?? 0)),
    [sessions],
  )
  const visibleSessions = useMemo(() => sortedSessions.slice(0, recordLimit), [sortedSessions, recordLimit])

  const days = useMemo(() => {
    const daily = ledgerTimeDistribution(sessions).days
    for (const day of ledger?.legacyDaily ?? []) daily.set(day.date, (daily.get(day.date) ?? 0) + day.durationSeconds)
    return [...daily.values()].filter((seconds) => seconds >= 60).length
  }, [sessions, ledger?.legacyDaily])
  const coverage = useMemo(() => [...ledgerCoverageByDate(sessions, ledger?.projectedLegacyIntervals ?? ledger?.legacyIntervals ?? []).values()].at(-1) ?? (ledger?.projectedLegacyIntervals ?? ledger?.legacyIntervals ?? []).reduce((sum, [start, end]) => sum + end - start, 0), [sessions, ledger?.projectedLegacyIntervals, ledger?.legacyIntervals])
  const estimates = useMemo(() => ledgerEstimates(sessions, coverage, round?.wordCount), [sessions, coverage, round?.wordCount])
  const legacyWords = (ledger?.legacyIntervals ?? []).reduce((sum, [start, end]) => sum + end - start, 0) * (ledger?.legacyWordCount ?? 0)
  const initialFraction = sortedSessions.map((session) => ledgerProgressBounds(session).end).filter((value) => value !== null).at(-1) ?? undefined

  const ringIntervals = useMemo(() => {
    const raw: Array<[number, number]> = []
    raw.push(...(ledger?.projectedLegacyIntervals ?? ledger?.legacyIntervals ?? []))
    for (const session of sessions) {
      const cov = session.projectedCoverage ?? session.coverage
      if (cov && Array.isArray(cov)) {
        raw.push(...cov)
      }
    }
    const sorted = raw
      .map(([a, b]): [number, number] => [Math.max(0, Math.min(1, Math.min(a, b))), Math.max(0, Math.min(1, Math.max(a, b)))])
      .filter(([a, b]) => b > a)
      .sort(([a], [b]) => a - b)
    const merged: Array<[number, number]> = []
    for (const [start, end] of sorted) {
      const last = merged.at(-1)
      if (last && start <= last[1]) {
        last[1] = Math.max(last[1], end)
      } else {
        merged.push([start, end])
      }
    }
    return merged
  }, [sessions, ledger?.legacyIntervals, ledger?.projectedLegacyIntervals])

  const earliestDate = useMemo(() => {
    let minDate: string | null = null
    for (const session of sessions) {
      if (!minDate || session.date < minDate) minDate = session.date
    }
    for (const legacy of ledger?.legacyDaily ?? []) {
      if (!minDate || legacy.date < minDate) minDate = legacy.date
    }
    return minDate
  }, [sessions, ledger?.legacyDaily])

  function formatPercent(value: number): string {
    const rounded = Number(value.toFixed(2))
    return `${rounded}%`
  }

  const latestProgress = useMemo(() => {
    if (book?.progress != null) {
      return Math.min(100, Math.max(0, book.progress))
    }
    const lastSessionEnd = sortedSessions
      .map((s) => ledgerProgressBounds(s).end)
      .filter((v): v is number => v !== null)
      .at(0)
    if (lastSessionEnd != null) {
      return lastSessionEnd * 100
    }
    return coverage * 100
  }, [book?.progress, sortedSessions, coverage])

  if (ledgerQuery.isError) return <QueryErrorState className="text-[var(--bd-read-sub)]" isRetrying={ledgerQuery.isFetching} onRetry={() => void ledgerQuery.refetch()} />
  if (ledgerQuery.isPending) return <div role="status" className="h-40 animate-pulse rounded-xl bg-stone-500/10" />

  const totalSeconds = ledger?.totalSeconds ?? 0
  const totalWords = Math.round(estimates.words + legacyWords)
  const totalWordsDisplay = totalWords > 0
    ? totalWords >= 10000
      ? `${(totalWords / 10000).toFixed(2)} 万`
      : totalWords.toLocaleString()
    : '—'
  const avgDailySeconds = days > 0 ? Math.round(totalSeconds / days) : null

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
          {recordLimit < sortedSessions.length && (
            <button
              type="button"
              onClick={() => setRecordLimit((limit) => limit + 20)}
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
