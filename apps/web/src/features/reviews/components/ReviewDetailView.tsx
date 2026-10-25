import type { Review } from '@bookdock/shared'

import ProfileIdentityLink from '@/features/profile/components/ProfileIdentityLink'
import { LockIcon } from '@/features/reader/components/annotation-icons'
import { useTranslation } from '@/hooks/useTranslation'

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

  return (
    <article className="min-w-0">
      {/* Author bar */}
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 pb-3 dark:border-stone-800">
        <div className="flex items-center gap-2 min-w-0">
          <ProfileIdentityLink
            userId={review.author.id}
            name={review.author.name}
            avatarKey={review.author.avatarKey}
            className="inline-flex items-center gap-2 text-sm font-medium text-stone-900 dark:text-stone-100 min-w-0"
            avatarClassName="h-7 w-7"
          />
          {review.visibility === 'private' && (
            <span title={_('review.visibilityPrivateHint')} className="flex items-center text-stone-400 dark:text-stone-500 shrink-0">
              <LockIcon size={12} />
            </span>
          )}
          {review.own && (
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500 dark:bg-stone-800 dark:text-stone-400 shrink-0">
              {_('review.ownBadge')}
            </span>
          )}
        </div>

        {review.rating != null ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <StarRating value={review.rating} size={15} />
          </div>
        ) : null}
      </div>

      {/* Review content */}
      <div className="pt-3">
        {/* Review Title */}
        {review.title && (
          <h3 className="mb-2 text-lg font-bold text-stone-900 dark:text-stone-100">
            {review.title}
          </h3>
        )}

        {/* Markdown Body */}
        {review.body && (
          <div className="text-base leading-7 text-stone-800 dark:text-stone-200">
            <ReviewMarkdown body={review.body} format={review.bodyFormat} />
          </div>
        )}
      </div>

      {/* Discussion panel (comments) */}
      <ReviewDiscussionPanel
        reviewId={review.id}
        reviewAuthorId={review.author.id}
        initialCommentCount={review.commentCount}
        initialLikeCount={review.likeCount}
        className="!mt-3"
        headerRight={
          <span className="flex items-center gap-1">
            <span>{_('annotation.publishedAt')}</span>
            <ReviewTime createdAt={review.createdAt} editedAt={review.editedAt} />
          </span>
        }
      />
    </article>
  )
}
