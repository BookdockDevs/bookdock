import { Link } from '@tanstack/react-router'

import type { ActivityItem } from '@bookdock/shared'

import ProfileIdentityLink from '@/features/profile/components/ProfileIdentityLink'
import { LockIcon } from '@/features/reader/components/annotation-icons'
import { formatFullDateTime, formatRelativeTime } from '@/features/reader/components/format-relative-time'
import StarRating from '@/features/reviews/components/StarRating'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import ActivityGroup from './ActivityGroup'
import type { ActivityFilter, ActivityScope } from '../hooks'

interface ActivityCardProps {
  item: ActivityItem
  onOpenIdea?: (ideaId: string, bookVersionId: string, title: string) => void
  onOpenReview?: (reviewId: string) => void
  onOpenCatalogWork?: (workId: string) => void
  scope: ActivityScope
  type: ActivityFilter
  libraryName?: string
}

function eventLabel(item: ActivityItem, scope: ActivityScope, _: ReturnType<typeof useTranslation>) {
  if (item.kind === 'idea') return _('activity.idea')
  if (item.kind === 'review') return _('activity.review')
  if (item.kind === 'catalog' || item.kind === 'catalog-group') {
    if (item.eventType === 'work.added') return _('activity.workAdded')
    if (item.eventType === 'version.added') return _('activity.versionAdded')
    return _('activity.revisionPublished')
  }
  const labels: Record<string, string> = {
    'work.trashed': _('activity.workTrashed'),
    'work.restored': _('activity.workRestored'),
    'work.deleted': _('activity.workDeleted'),
    'version.deleted': _('activity.versionDeleted'),
    'idea.deleted': _('activity.ideaDeleted'),
    'review.deleted': _('activity.reviewDeleted'),
    'comment.deleted': _('activity.commentDeleted'),
    'reply.deleted': _('activity.replyDeleted'),
  }
  return labels[item.eventType] ?? _('activity.management')
}

export default function ActivityCard({ item, onOpenIdea, onOpenReview, onOpenCatalogWork, scope, type, libraryName }: ActivityCardProps) {
  const _ = useTranslation()
  const grouped = item.kind === 'catalog-group' || item.kind === 'management-group'
  const source = scope === 'personal'
    ? item.libraryId ? item.kind === 'idea' || item.kind === 'review' ? item.content.libraryName : libraryName : null
    : null
  const isManagement = item.kind === 'management' || item.kind === 'management-group'
  const isPrivateContent = scope === 'personal' && (item.kind === 'idea' || item.kind === 'review') && item.visibility === 'private'
  const isSharedPrivate = isPrivateContent && Boolean(item.libraryId)
  const workTitle = item.kind === 'idea' || item.kind === 'review'
    ? item.content.workTitle || (isPrivateContent ? _('archive.sourceUnavailable') : '')
    : ''

  return (
    <article className={cn('rounded-xl border transition-all', isManagement || item.kind === 'catalog' || item.kind === 'catalog-group' ? 'border-stone-200/70 bg-stone-50/50 p-3.5 hover:border-stone-300 dark:border-stone-800/70 dark:bg-stone-900/30 dark:hover:border-stone-700' : 'border-stone-200/80 bg-white/70 p-4 hover:border-stone-300 hover:shadow-2xs dark:border-stone-800 dark:bg-stone-900/40 dark:hover:border-stone-700')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {scope === 'library' && (item.actor.id && item.actor.name !== '账号不可用' ? (
          <ProfileIdentityLink
            userId={item.actor.id}
            name={item.actor.name}
            avatarKey={item.actor.avatarKey}
            className="inline-flex items-center gap-2 text-[13px] font-medium text-stone-800 hover:underline dark:text-stone-100"
            avatarClassName="h-6 w-6"
          />
        ) : (
          <span className="text-[13px] font-medium text-stone-700 dark:text-stone-200">{item.actor.name}</span>
        ))}
        <span className="text-stone-400 dark:text-stone-500">{eventLabel(item, scope, _)}</span>
        {isSharedPrivate && (
          <span title={_('annotation.visibilityPrivate')} className="inline-flex items-center text-stone-400 dark:text-stone-500">
            <LockIcon size={12} />
          </span>
        )}
        <time
          className="ml-auto text-stone-400 select-none dark:text-stone-500"
          title={formatFullDateTime(_, item.occurredAt)}
          dateTime={new Date(item.occurredAt).toISOString()}
        >
          {formatRelativeTime(_, item.occurredAt)}
        </time>
      </div>
      <div className="mt-2.5">
        {item.kind === 'idea' && (
          <div>
            <button
              type="button"
              disabled={!item.target.bookVersionId}
              className="group/btn w-full text-left cursor-pointer disabled:cursor-default"
              onClick={() => { if (item.target.bookVersionId) onOpenIdea?.(item.target.ideaId, item.target.bookVersionId, workTitle) }}
            >
              {item.content.excerpt ? (
                <p className="text-sm font-normal leading-relaxed text-stone-900 whitespace-pre-wrap line-clamp-4 dark:text-stone-100">
                  {item.content.excerpt}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                <span className="font-medium text-stone-700 transition-colors group-hover/btn:text-stone-950 dark:text-stone-300 dark:group-hover/btn:text-white">
                  {workTitle}
                </span>
                {item.content.chapter && <span>· {item.content.chapter}</span>}
              </div>
            </button>
            {source && item.libraryId && (
              <div className="mt-2 flex items-center gap-1 text-xs text-stone-400 dark:text-stone-500">
                <Link
                  to="/"
                  search={{ libraryId: item.libraryId }}
                  className="transition-colors hover:text-stone-700 dark:hover:text-stone-300"
                >
                  {source}
                </Link>
              </div>
            )}
          </div>
        )}
        {item.kind === 'review' && (
          <div>
            <button
              type="button"
              className="group/btn w-full text-left cursor-pointer"
              onClick={() => onOpenReview?.(item.target.reviewId)}
            >
              {(item.content.ratingHalves !== null || item.content.title) && (
                <div className="flex flex-wrap items-center gap-2">
                  {item.content.ratingHalves !== null && (
                    <span className="inline-flex align-middle">
                      <StarRating value={item.content.ratingHalves / 2} size={14} />
                    </span>
                  )}
                  {item.content.title && (
                    <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                      {item.content.title}
                    </span>
                  )}
                </div>
              )}
              {item.content.excerpt && (
                <p className="mt-1 text-sm leading-relaxed text-stone-800 line-clamp-4 dark:text-stone-200">
                  {item.content.excerpt}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                <span className="font-medium text-stone-700 transition-colors group-hover/btn:text-stone-950 dark:text-stone-300 dark:group-hover/btn:text-white">
                  {workTitle}
                </span>
              </div>
            </button>
            {source && item.libraryId && (
              <div className="mt-2 flex items-center gap-1 text-xs text-stone-400 dark:text-stone-500">
                <Link
                  to="/"
                  search={{ libraryId: item.libraryId }}
                  className="transition-colors hover:text-stone-700 dark:hover:text-stone-300"
                >
                  {source}
                </Link>
              </div>
            )}
          </div>
        )}
        {item.kind === 'catalog' && (
          <div className="mt-1 text-xs text-stone-700 dark:text-stone-300">
            <button
              type="button"
              disabled={!onOpenCatalogWork}
              className="group/catalog inline-flex items-center gap-1 text-left font-medium text-stone-700 transition-colors hover:text-stone-950 disabled:cursor-default dark:text-stone-300 dark:hover:text-white"
              onClick={() => onOpenCatalogWork?.(item.target.workId)}
            >
              <span className="font-semibold">{item.content.workTitle}</span>
              {item.content.objectLabel && <span className="font-normal text-stone-500">· {item.content.objectLabel}</span>}
            </button>
          </div>
        )}
        {item.kind === 'catalog-group' && (
          <div className="mt-1.5 flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300">
            <span className="rounded-md bg-stone-200/60 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {item.count} 项
            </span>
            <span className="font-medium">{item.preview[0]?.workTitle} 等</span>
          </div>
        )}
        {item.kind === 'management' && (item.content.workTitle || item.content.objectLabel) && (
          <div className="mt-1 text-xs text-stone-700 dark:text-stone-300">
            <span className="font-medium">{item.content.workTitle && item.content.objectLabel && item.content.workTitle !== item.content.objectLabel ? `${item.content.workTitle} · ${item.content.objectLabel}` : item.content.workTitle ?? item.content.objectLabel}</span>
          </div>
        )}
        {item.kind === 'management-group' && (
          <div className="mt-1 flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300">
            <span className="rounded-md bg-stone-200/60 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {item.count} 项
            </span>
            {(item.preview[0]?.workTitle || item.preview[0]?.objectLabel) && (
              <span className="font-medium">{item.preview[0]?.workTitle && item.preview[0].objectLabel && item.preview[0].workTitle !== item.preview[0].objectLabel ? `${item.preview[0].workTitle} · ${item.preview[0].objectLabel}` : item.preview[0]?.workTitle ?? item.preview[0]?.objectLabel}</span>
            )}
          </div>
        )}
      </div>
      {grouped && <ActivityGroup item={item} scope={scope} targetId={item.libraryId} type={type} onOpenCatalogWork={onOpenCatalogWork} />}
    </article>
  )
}
