import { useState } from 'react'

import type { ActivityItem } from '@bookdock/shared'

import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'

import { useActivityGroup, type ActivityFilter, type ActivityScope } from '../hooks'

interface ActivityGroupProps {
  item: Extract<ActivityItem, { kind: 'catalog-group' | 'management-group' }>
  scope: ActivityScope
  targetId: string
  type: ActivityFilter
  onOpenCatalogWork?: (workId: string) => void
}

export default function ActivityGroup({ item, scope, targetId, type, onOpenCatalogWork }: ActivityGroupProps) {
  const _ = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const group = useActivityGroup(scope, targetId, type, item.eventId, expanded)
  const items = group.data?.pages.flatMap((page) => page.data.items) ?? []

  return (
    <div className="mt-3 border-t border-stone-100 pt-2 dark:border-stone-800">
      <button type="button" aria-expanded={expanded} className="text-xs font-medium text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-white" onClick={() => setExpanded((value) => !value)}>
        {expanded ? _('activity.collapse') : _('activity.showItems', { count: item.count })}
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          {group.isPending && <div role="status" className="h-12 animate-pulse rounded-lg bg-stone-500/10" />}
          {group.isError && <QueryErrorState isRetrying={group.isFetching} onRetry={() => void group.refetch()} />}
          {items.map((child) => (
            <div key={child.eventId} className="rounded-lg bg-stone-50 px-3 py-2 text-sm dark:bg-stone-800/60">
              {child.kind === 'catalog' ? (
                <button type="button" disabled={!onOpenCatalogWork} className="text-left font-medium text-stone-700 hover:text-stone-950 disabled:cursor-default dark:text-stone-200 dark:hover:text-white" onClick={() => onOpenCatalogWork?.(child.target.workId)}>
                  {child.content.workTitle}{child.content.objectLabel && <span className="ml-2 font-normal text-stone-500">· {child.content.objectLabel}</span>}
                </button>
              ) : child.kind === 'management' ? (
                <span className="text-stone-600 dark:text-stone-300">{child.content.workTitle && child.content.objectLabel && child.content.workTitle !== child.content.objectLabel ? `${child.content.workTitle} · ${child.content.objectLabel}` : child.content.workTitle ?? child.content.objectLabel}</span>
              ) : null}
              <time className="ml-2 text-xs text-stone-400" dateTime={new Date(child.occurredAt).toISOString()}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(child.occurredAt))}</time>
            </div>
          ))}
          {group.hasNextPage && <button type="button" disabled={group.isFetchingNextPage} onClick={() => void group.fetchNextPage()} className="self-start rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300">{group.isFetchingNextPage ? _('activity.loading') : _('activity.loadMore')}</button>}
        </div>
      )}
    </div>
  )
}
