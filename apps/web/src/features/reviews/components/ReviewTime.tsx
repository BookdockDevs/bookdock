import { formatFullDateTime, formatRelativeTime } from '@/features/reader/components/format-relative-time'
import { useTranslation } from '@/hooks/useTranslation'

/**
 * Unified published/edited time display for reviews and review comments:
 * relative createdAt with a full-datetime hover title, plus an edited badge
 * with its own hover title only when content actually changed. Hover titles
 * reuse the native `title` tooltip like the rest of the app; the relative
 * text itself stays visible so touch users lose nothing.
 */
export default function ReviewTime({ createdAt, editedAt }: {
  createdAt: number
  editedAt: number | null
}) {
  const _ = useTranslation()
  return (
    <span title={_('review.publishedTimeTitle', { value: formatFullDateTime(_, createdAt) })}>
      {formatRelativeTime(_, createdAt)}
      {editedAt ? (
        <> · <span title={_('review.editedTimeTitle', { value: formatFullDateTime(_, editedAt) })}>{_('review.edited')}</span></>
      ) : (
        ''
      )}
    </span>
  )
}
