import { useEffect } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import ArchivePager from '@/features/profile/components/ArchivePager'
import { formatRelativeTime } from '@/features/reader/components/format-relative-time'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import NotificationContent from './components/NotificationContent'
import { useNotificationRead, useNotifications, useNotificationTarget } from './hooks'

export default function NotificationCenter() {
  const _ = useTranslation()
  usePageTitle(_('notificationCenter.title'))
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const search = useSearch({ from: '/notifications' })
  const list = useNotifications(search.page ?? 1)
  const target = useNotificationTarget(search.id)
  const read = useNotificationRead()
  const markRead = read.mutate
  useEffect(() => { if (!user) void navigate({ to: '/login' }) }, [user, navigate])
  const openedId = target.data?.data.available ? target.data.data.notification.id : undefined
  const unreadTarget = target.data?.data.available && target.data.data.notification.readAt === null
  useEffect(() => {
    if (openedId && unreadTarget) markRead({ id: openedId, read: true }, {
      onError: (error) => notify.error(getUserErrorNotification(error, 'notificationCenter.readFailed')),
    })
  }, [openedId, unreadTarget, markRead])
  if (!user) return null
  return <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
    <header className="flex items-center gap-3">
      <Link to="/" className="text-sm text-stone-500">{_('profile.back')}</Link>
      <h1 className="flex-1 text-xl font-bold">{_('notificationCenter.title')}</h1>
      <Button size="sm" variant="ghost" disabled={read.isPending} onClick={() => read.mutate({ all: true }, { onError: (error) => notify.error(getUserErrorNotification(error, 'notificationCenter.readFailed')) })}>{_('notificationCenter.readAll')}</Button>
    </header>
    {list.isPending ? <div role="status" className="h-24 animate-pulse rounded-xl bg-stone-500/10" />
      : list.isError ? <QueryErrorState isRetrying={list.isFetching} onRetry={() => void list.refetch()} />
      : !list.data?.data.entries.length ? <p className="py-12 text-center text-sm text-stone-500">{_('notificationCenter.empty')}</p>
      : <ul className="space-y-2">{list.data.data.entries.map((entry) => <li key={entry.id} className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-start gap-3">
          <Link to="/notifications" search={{ ...search, id: entry.id }} className="min-w-0 flex-1">
            <p className="text-sm"><span className="font-medium">{entry.actor.name}</span> {_('notificationCenter.' + entry.event)}{!entry.readAt && <span data-testid="notification-unread-dot" className="ml-2 inline-block h-2 w-2 rounded-full bg-red-500" aria-label={_('notificationCenter.unread')} />}</p>
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm text-stone-500">{entry.preview}</p>
            <time className="mt-1 block text-xs text-stone-400">{formatRelativeTime(_, entry.createdAt)}</time>
          </Link>
          <Button size="sm" variant="ghost" disabled={read.isPending} onClick={() => read.mutate({ id: entry.id, read: entry.readAt === null }, { onError: (error) => notify.error(getUserErrorNotification(error, 'notificationCenter.readFailed')) })}>{_(entry.readAt === null ? 'notificationCenter.markRead' : 'notificationCenter.markUnread')}</Button>
        </div>
      </li>)}</ul>}
    <ArchivePager page={search.page ?? 1} hasMore={list.data?.data.hasMore ?? false} disabled={list.isFetching} onChange={(page) => void navigate({ to: '/notifications', search: { page } })} />
    {search.id && <Modal title={_('notificationCenter.target')} onClose={() => void navigate({ to: '/notifications', search: { page: search.page } })}>
      {target.isPending ? <div role="status" className="h-24 animate-pulse rounded-xl bg-stone-500/10" />
        : target.isError ? <QueryErrorState isRetrying={target.isFetching} onRetry={() => void target.refetch()} />
        : target.data?.data.available ? <NotificationContent key={search.id} notification={target.data.data.notification} />
        : <p role="status" className="py-6 text-sm text-stone-500">{_('notificationCenter.unavailable')}</p>}
    </Modal>}
  </div>
}
