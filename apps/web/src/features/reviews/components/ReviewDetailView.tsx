import type { Review } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'

import ReviewDiscussionPanel from './ReviewDiscussionPanel'
import ReviewMarkdown from './ReviewMarkdown'
import ReviewTime from './ReviewTime'
import StarRating from './StarRating'

export interface ReviewDetailViewProps {
  review: Review
}

export default function ReviewDetailView({
  review,
}: ReviewDetailViewProps) {
  const _ = useTranslation()

  const authorAvatar = avatarUrl(review.author.avatarKey)

  return (
    <article className="space-y-4">
      {/* Author bar */}
      <div className="flex items-start justify-between gap-3 border-b border-stone-100 pb-3 dark:border-stone-800">
        <div className="flex items-center gap-2.5">
          {authorAvatar ? (
            <img src={authorAvatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-500/10 text-sm font-medium text-stone-600 dark:text-stone-400">
              {review.author.name.slice(0, 1)}
            </span>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                {review.author.name}
              </span>
              {review.own && (
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                  {_('review.ownBadge')}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
              <ReviewTime createdAt={review.createdAt} editedAt={review.editedAt} />
              {review.visibility === 'private' && (
                <span>· {_('review.visibilityPrivateHint')}</span>
              )}
            </div>
          </div>
        </div>

        {review.rating != null ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <StarRating value={review.rating} size={15} />
          </div>
        ) : null}
      </div>

      {/* Review Title */}
      {review.title && (
        <h3 className="text-lg font-bold text-stone-900 dark:text-stone-100">
          {review.title}
        </h3>
      )}

      {/* Markdown Body */}
      {review.body && (
        <div className="py-1">
          <ReviewMarkdown body={review.body} format={review.bodyFormat} />
        </div>
      )}

      {/* Discussion panel (comments) */}
      <div className="mt-4 border-t border-stone-100 pt-4 dark:border-stone-800">
        <ReviewDiscussionPanel
          reviewId={review.id}
          reviewAuthorId={review.author.id}
          initialCommentCount={review.commentCount}
          initialLikeCount={review.likeCount}
        />
      </div>
    </article>
  )
}
