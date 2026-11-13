import { formatRelativeTime } from '@/features/reader/components/format-relative-time'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDateTime } from '@/lib/utils'

/**
 * Where the reader stopped, for whichever book is on screen - a private card
 * or a version of a shared work. Reading progress is stored per book version,
 * so a shared version the caller has read reports the same numbers a private
 * card does. Nothing renders before the book has been opened once.
 */
export default function ReadingProgress({
  progress,
  lastReadAt,
}: {
  progress?: number | null
  lastReadAt?: number | null
}) {
  const _ = useTranslation()
  // Started without progress still counts: the bar then reads 0% instead of
  // disappearing, which is what "opened but not advanced" looks like.
  const started = (progress != null && progress > 0) || Boolean(lastReadAt)
  if (!started) return null
  const percent = Math.round(progress ?? 0)
  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
        <span className="tabular-nums font-medium text-stone-600 dark:text-stone-300">
          {percent}%
        </span>
        {lastReadAt ? (
          <span className="text-[11px] text-stone-400 dark:text-stone-500" title={formatDateTime(lastReadAt)}>
            {formatRelativeTime(_, lastReadAt)}
          </span>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label={_('library.readingProgress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
      >
        <div
          className="h-full rounded-full bg-stone-700 dark:bg-stone-400"
          style={{ width: `${progress ?? 0}%` }}
        />
      </div>
    </div>
  )
}
