import { useState } from 'react'

import type { MyReviewEntry } from '@bookdock/shared'

import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'

import { useMyReviews } from '../hooks/useReviews'
import { reviewExcerpt } from '../lib/markdown'
import ReviewCard from './ReviewCard'
import StarRating from './StarRating'

function statusBadge(entry: MyReviewEntry, t: (key: string) => string) {
  const map: Record<MyReviewEntry['sourceStatus'], string> = {
    ok: t('review.sourceOk'),
    private: t('review.visibilityPrivate'),
    trashed: t('review.sourceTrashed'),
    deleted: t('review.sourceDeleted'),
    'library-deleted': t('review.sourceLibraryDeleted'),
  }
  const dim = entry.sourceStatus === 'ok' || entry.sourceStatus === 'private'
  return (
    <span
      className={
        dim
          ? 'rounded bg-stone-500/15 px-1.5 py-px text-[10px] text-stone-500 dark:text-stone-400'
          : 'rounded bg-amber-500/15 px-1.5 py-px text-[10px] text-amber-700 dark:text-amber-400'
      }
    >
      {map[entry.sourceStatus]}
    </span>
  )
}

export default function MyReviewsSection() {
  const _ = useTranslation()
  const query = useMyReviews()
  const [openId, setOpenId] = useState<string | null>(null)
  const entries = query.data?.data.entries ?? []
  const open = entries.find((entry) => entry.review.id === openId) ?? null

  if (query.isPending) {
    return (
      <div className="animate-pulse space-y-2 rounded-2xl border border-stone-200/80 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <div className="h-4 w-32 rounded bg-stone-500/15" />
        <div className="h-12 rounded-xl bg-stone-500/10" />
      </div>
    )
  }
  if (query.isError) return null
  if (entries.length === 0) return null

  return (
    <section aria-label={_('review.myReviews')} className="rounded-2xl border border-stone-200/80 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-3 text-sm font-semibold tracking-tight text-stone-900 sm:text-base dark:text-stone-100">
        {_('review.myReviews')} · <span className="tabular-nums font-normal text-stone-400">{entries.length}</span>
      </h2>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.review.id}>
            <button
              type="button"
              onClick={() => setOpenId(entry.review.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-stone-200/60 px-3 py-2.5 text-left transition-colors hover:bg-stone-50 dark:border-stone-800/60 dark:hover:bg-stone-800/40"
            >
              <StarRating value={entry.review.rating} size={13} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-stone-700 dark:text-stone-200">
                  {entry.workTitle ?? _('review.sourceGoneTitle')}
                </span>
                {entry.review.body && (
                  <span className="block truncate text-xs text-stone-400 dark:text-stone-500">
                    {reviewExcerpt(entry.review.body, entry.review.bodyFormat, 80)}
                  </span>
                )}
              </span>
              {statusBadge(entry, _)}
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <Modal title={open.workTitle ?? _('review.sourceGoneTitle')} onClose={() => setOpenId(null)} closeLabel={_('library.close')} size="xl">
          <div className="mb-2">{statusBadge(open, _)}</div>
          <ReviewCard review={open.review} />
        </Modal>
      )}
    </section>
  )
}
