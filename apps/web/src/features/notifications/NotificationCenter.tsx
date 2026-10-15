import { useEffect } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'

import { Button } from '@/components/ui/Button'
import QueryErrorState from '@/components/ui/QueryErrorState'
import ArchivePager from '@/features/profile/components/ArchivePager'
import { formatRelativeTime } from '@/features/reader/components/format-relative-time'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification, isAccessRevocationError } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import NotificationDetailModal from './components/NotificationDetailModal'
import { useNotificationRead, useNotifications } from './hooks'
import { notificationActionKey } from './notification-copy'

export default function NotificationCenter() {
  const _ = useTranslation()
  usePageTitle(_('notificationCenter.title'))
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const search = useSearch({ from: '/notifications' })
  const list = useNotifications(search.page ?? 1)
  const read = useNotificationRead()
  useEffect(() => { if (!user) void navigate({ to: '/login' }) }, [user, navigate])
  if (!user) return null
  return <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
    <header className="flex items-center gap-3">
      <Link to="/" className="text-sm text-stone-500 transition-colors hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200">{_('profile.back')}</Link>
      <h1 className="flex-1 text-xl font-bold text-stone-900 dark:text-stone-100">{_('notificationCenter.title')}</h1>
      <Button size="sm" variant="ghost" disabled={read.isPending} onClick={() => read.mutate({ all: true }, { onError: (error) => notify.error(getUserErrorNotification(error, 'notificationCenter.readFailed')) })}>{_('notificationCenter.readAll')}</Button>
    </header>
    {list.isPending ? <div role="status" aria-busy="true" className="h-24 animate-pulse rounded-xl bg-stone-500/10 motion-reduce:animate-none" />
      : list.isError && (!list.data || isAccessRevocationError(list.error)) ? <QueryErrorState isRetrying={list.isFetching} onRetry={() => void list.refetch()} />
      : !list.data?.data.entries.length ? <p className="py-12 text-center text-sm text-stone-500 dark:text-stone-400">{_('notificationCenter.empty')}</p>
      : <>
        {list.isError && !isAccessRevocationError(list.error) && (
          <div className="flex items-center justify-between rounded-xl border border-amber-200/80 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-700 dark:border-amber-800/80 dark:bg-amber-500/20 dark:text-amber-300">
            <span>{_('notificationCenter.revalidateFailed') || '通知刷新失败，正在显示缓存'}</span>
            <button
              type="button"
              onClick={() => void list.refetch()}
              disabled={list.isFetching}
              className="font-medium underline hover:no-underline cursor-pointer"
            >
              {_('common.retry') || '重试'}
            </button>
          </div>
        )}
        <ul className="space-y-2">{list.data.data.entries.map((entry) => <li key={entry.id} className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-start gap-3">
            <Link to="/notifications" search={{ ...search, id: entry.id }} className="min-w-0 flex-1">
              <p className="text-sm text-stone-900 dark:text-stone-100"><span className="font-medium">{entry.actor.name}</span> {_(notificationActionKey(entry))}{!entry.readAt && <span data-testid="notification-unread-dot" className="ml-2 inline-block h-2 w-2 rounded-full bg-red-500" aria-label={_('notificationCenter.unread')} />}</p>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm text-stone-500 dark:text-stone-400">{entry.preview}</p>
              <time className="mt-1 block text-xs text-stone-400 dark:text-stone-500">{formatRelativeTime(_, entry.createdAt)}</time>
            </Link>
            <Button size="sm" variant="ghost" disabled={read.isPending} onClick={() => read.mutate({ id: entry.id, read: entry.readAt === null }, { onError: (error) => notify.error(getUserErrorNotification(error, 'notificationCenter.readFailed')) })}>{_(entry.readAt === null ? 'notificationCenter.markRead' : 'notificationCenter.markUnread')}</Button>
          </div>
        </li>)}</ul>
      </>}
    <ArchivePager page={search.page ?? 1} hasMore={list.data?.data.hasMore ?? false} disabled={list.isFetching} onChange={(page) => void navigate({ to: '/notifications', search: { page } })} />
    {search.id && <NotificationDetailModal key={search.id} notificationId={search.id} entry={list.data?.data.entries.find((entry) => entry.id === search.id)} onClose={() => void navigate({ to: '/notifications', search: { page: search.page } })} />}
  </div>
}
