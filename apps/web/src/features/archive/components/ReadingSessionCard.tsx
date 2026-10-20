import type { ReadingLedgerSession } from '@bookdock/shared'

import SmartMenu, {
  menuDangerItemClass,
  menuItemClass,
  readerMenuDangerItemClass,
  readerMenuItemClass,
} from '@/components/ui/SmartMenu'
import { ledgerProgressBounds } from '@/features/archive/components/reading-ledger-stats'
import { useContextMenu } from '@/features/library/components/use-context-menu'
import { PencilIcon, TrashIcon } from '@/features/reader/components/annotation-icons'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

export interface ReadingSessionCardProps {
  session: ReadingLedgerSession
  totalWordCount?: number
  onEdit?: (session: ReadingLedgerSession) => void
  onDelete?: (session: ReadingLedgerSession) => void
  className?: string
  variant?: 'default' | 'reader'
}

function formatSessionDateTimeRange(session: ReadingLedgerSession): string {
  if (session.startedAt && session.endedAt) {
    const sDate = new Date(session.startedAt)
    const eDate = new Date(session.endedAt)
    const pad = (n: number) => String(n).padStart(2, '0')
    const sYear = sDate.getFullYear()
    const sMonth = pad(sDate.getMonth() + 1)
    const sDay = pad(sDate.getDate())
    const sHour = pad(sDate.getHours())
    const sMin = pad(sDate.getMinutes())

    const isSameDay =
      sDate.getFullYear() === eDate.getFullYear() &&
      sDate.getMonth() === eDate.getMonth() &&
      sDate.getDate() === eDate.getDate()

    const eHour = pad(eDate.getHours())
    const eMin = pad(eDate.getMinutes())

    if (isSameDay) {
      return `${sYear}.${sMonth}.${sDay} ${sHour}:${sMin}~${eHour}:${eMin}`
    }

    const eMonth = pad(eDate.getMonth() + 1)
    const eDay = pad(eDate.getDate())
    return `${sYear}.${sMonth}.${sDay} ${sHour}:${sMin}~${eMonth}.${eDay} ${eHour}:${eMin}`
  }

  return session.date.replace(/-/g, '.')
}

function formatCardDuration(seconds: number, translate: ReturnType<typeof useTranslation>): string {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return translate('stats.durationSeconds', { s: total })
  const totalMin = Math.floor(total / 60)
  const remainingSeconds = total % 60
  if (totalMin < 60) {
    return remainingSeconds > 0
      ? translate('readingData.minuteSecond', { m: totalMin, s: remainingSeconds })
      : translate('readingData.compactMinutes', { n: totalMin })
  }
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? translate('readingData.compactHoursMinutes', { h, m }) : translate('readingData.compactHours', { h })
}

export default function ReadingSessionCard({
  session,
  totalWordCount,
  onEdit,
  onDelete,
  className,
  variant = 'default',
}: ReadingSessionCardProps) {
  const _ = useTranslation()
  const isReader = variant === 'reader'
  const contextMenu = useContextMenu()

  const { start: rawStart, end: rawEnd } = ledgerProgressBounds(session)
  const startPct = rawStart !== null ? Number((rawStart * 100).toFixed(2)) : null
  const endPct = rawEnd !== null ? Number((rawEnd * 100).toFixed(2)) : null

  const deltaPct =
    startPct !== null && endPct !== null
      ? Number(Math.max(0, endPct - startPct).toFixed(2))
      : null
  const bookWords = session.wordCount || totalWordCount || 0
  const sessionWords =
    deltaPct !== null && bookWords > 0 ? (deltaPct / 100) * bookWords : 0

  const wordsIsWan = sessionWords >= 10000
  const wordsValueText =
    sessionWords > 0
      ? wordsIsWan
        ? (sessionWords / 10000).toFixed(2)
        : Math.round(sessionWords).toLocaleString()
      : '—'
  const wordsLabel = wordsIsWan ? _('readingData.wordsTenThousand') : _('readingData.recordWords')

  const startEndText =
    startPct !== null && endPct !== null ? `${startPct}-${endPct}` : '—'

  const dateText = formatSessionDateTimeRange(session)
  const durationText = formatCardDuration(session.durationSeconds, _)

  const canEdit = Boolean(
    onEdit &&
      session.source !== 'auto' &&
      (session.source !== 'legacy' || session.endedAt !== null),
  )

  return (
    <article
      onContextMenu={(e) => {
        if (!canEdit && !onDelete) return
        e.preventDefault()
        e.stopPropagation()
        contextMenu.openFromEvent(e)
      }}
      className={cn(
        'group relative rounded-2xl border transition-all',
        isReader
          ? 'border-[var(--bd-read-accent)]/80 bg-[var(--bd-read-bg)] p-3.5 sm:p-4'
          : 'border-stone-200/80 bg-white p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900/60',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              'text-xs font-medium tabular-nums tracking-tight truncate',
              isReader ? 'text-[var(--bd-read-sub)]' : 'text-stone-400 dark:text-stone-500',
            )}
          >
            {dateText}
          </span>
          {session.source === 'auto' && (
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none select-none',
                isReader
                  ? 'bg-[var(--bd-read-accent)]/30 text-[var(--bd-read-text)]'
                  : 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',
              )}
            >
              {_('readingData.source.auto')}
            </span>
          )}
        </div>
        {isReader ? (
          <span className="inline-flex items-center rounded-full bg-stone-500/10 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--bd-read-text)] shrink-0 select-none">
            {durationText}
          </span>
        ) : (
          (canEdit || onDelete) && (
            <div className="relative shrink-0">
              <button
                ref={contextMenu.btnRef}
                type="button"
                onClick={contextMenu.toggleFromButton}
                aria-label={_('readingData.moreActions')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300 transition-colors cursor-pointer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </button>
            </div>
          )
        )}
      </div>
      {isReader ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-left">
          <div className="min-w-0">
            <div className="text-sm font-bold tabular-nums text-[var(--bd-read-text)] truncate">
              {deltaPct !== null ? deltaPct : '—'}
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-[var(--bd-read-sub)] select-none truncate">
              {_('readingData.progressPercent')}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold tabular-nums text-[var(--bd-read-text)] truncate">
              {wordsValueText}
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-[var(--bd-read-sub)] select-none truncate">
              {wordsLabel}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold tabular-nums text-[var(--bd-read-text)] truncate">
              {startEndText}
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-[var(--bd-read-sub)] select-none truncate">
              {_('readingData.progressBounds')}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-2 text-left sm:gap-4">
          <div>
            <div className="text-sm font-bold tabular-nums sm:text-base text-stone-900 dark:text-stone-100 truncate">
              {durationText}
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-stone-400 dark:text-stone-500 select-none truncate">
              {_('readingData.duration')}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold tabular-nums sm:text-base text-stone-900 dark:text-stone-100 truncate">
              {deltaPct !== null ? deltaPct : '—'}
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-stone-400 dark:text-stone-500 select-none truncate">
              {_('readingData.progressPercent')}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold tabular-nums sm:text-base text-stone-900 dark:text-stone-100 truncate">
              {wordsValueText}
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-stone-400 dark:text-stone-500 select-none truncate">
              {wordsLabel}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold tabular-nums sm:text-base text-stone-900 dark:text-stone-100 truncate">
              {startEndText}
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-stone-400 dark:text-stone-500 select-none truncate">
              {_('readingData.progressBounds')}
            </div>
          </div>
        </div>
      )}

      {(canEdit || onDelete) && contextMenu.open && (
        <SmartMenu
          innerRef={contextMenu.menuRef}
          triggerRef={isReader ? undefined : contextMenu.btnRef}
          position={contextMenu.position(136, (canEdit ? 36 : 0) + (onDelete ? 36 : 0) + 16)}
          onClose={contextMenu.close}
          width={136}
          variant={variant}
        >
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                contextMenu.close()
                onEdit?.(session)
              }}
              className={cn(
                isReader ? readerMenuItemClass : menuItemClass,
                'cursor-pointer',
              )}
            >
              <span className={cn('shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5', isReader ? 'text-[var(--bd-read-sub)]' : 'text-stone-500 dark:text-stone-400')}>
                <PencilIcon />
              </span>
              <span>{_('reader.sessionEdit')}</span>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => {
                contextMenu.close()
                onDelete(session)
              }}
              className={cn(
                isReader ? readerMenuDangerItemClass : menuDangerItemClass,
                'cursor-pointer',
              )}
            >
              <span className="shrink-0 text-red-500 dark:text-red-400 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <TrashIcon />
              </span>
              <span>{_('reader.sessionDelete')}</span>
            </button>
          )}
        </SmartMenu>
      )}
    </article>
  )
}
