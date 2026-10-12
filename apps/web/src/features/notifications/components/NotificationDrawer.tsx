import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject, type UIEvent } from 'react'
import { createPortal } from 'react-dom'

import QueryErrorState from '@/components/ui/QueryErrorState'
import { formatRelativeTime } from '@/features/reader/components/format-relative-time'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { computeDropdownPosition, type SmartPosition } from '@/lib/position'

import { useInfiniteNotifications, useNotificationDelete, useNotificationRead, useUnreadNotifications } from '../hooks'
import { notificationActionKey } from '../notification-copy'
import NotificationDetailModal from './NotificationDetailModal'

interface NotificationDrawerProps {
  anchorRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onClose: () => void
}

const POPOVER_WIDTH = 380
const POPOVER_MAX_HEIGHT = 520
const POPOVER_MARGIN = 12

export default function NotificationDrawer({ anchorRef, open, onClose }: NotificationDrawerProps) {
  const _ = useTranslation()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousActiveRef = useRef<HTMLElement | null>(null)
  const [position, setPosition] = useState<SmartPosition | null>(null)
  const list = useInfiniteNotifications(unreadOnly, open)
  const unread = useUnreadNotifications()
  const read = useNotificationRead()
  const remove = useNotificationDelete()
  const entries = useMemo(() => list.data?.pages.flatMap((page) => page.data.entries) ?? [], [list.data])
  const unreadCount = unread.data?.data.count ?? 0

  useEffect(() => {
    if (!open) return
    previousActiveRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    requestAnimationFrame(() => closeRef.current?.focus())
    return () => {
      previousActiveRef.current?.focus()
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = anchorRef.current
      if (!anchor) return
      const width = Math.min(POPOVER_WIDTH, Math.max(1, window.innerWidth - POPOVER_MARGIN * 2))
      const rect = anchor.getBoundingClientRect()
      setPosition(computeDropdownPosition(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        width,
        POPOVER_MAX_HEIGHT,
        'end',
        8,
      ))
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open, selectedId])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      if (selectedId && (target instanceof Element) && target.closest('[role="dialog"][aria-modal="true"]')) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [anchorRef, onClose, open, selectedId])

  useEffect(() => {
    if (!open) {
      setSelectedId(null)
      setMenuId(null)
    }
  }, [open ])

  useEffect(() => {
    if (!menuId) return
    const closeMenu = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLElement) || !event.target.closest('[data-notification-menu]')) setMenuId(null)
    }
    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [menuId])

  if (!open || !position) return null

  const openNotification = (id: string, readAt: number | null) => {
    setSelectedId(id)
    if (readAt === null) {
      read.mutate({ id, read: true }, {
        onError: (error) => notify.error(getUserErrorNotification(error, 'notificationCenter.readFailed')),
      })
    }
  }

  const deleteEntry = (id: string) => {
    remove.mutate(id, {
      onSuccess: () => setMenuId(null),
      onError: (error) => notify.error(getUserErrorNotification(error, 'notificationDrawer.deleteFailed')),
    })
  }

  const onListScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 160 && list.hasNextPage && !list.isFetchingNextPage) {
      void list.fetchNextPage()
    }
  }

  return createPortal(
    <>
      <aside
        ref={panelRef}
        role="dialog"
        aria-labelledby="notification-popover-title"
        className={`animate-modal-panel fixed z-50 flex max-h-[min(60vh,520px)] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg outline-none dark:border-stone-700 dark:bg-stone-900 ${position.dir === 'down' ? 'origin-top-right' : 'origin-bottom-right'}`}
        style={{ left: position.left, top: position.top, width: `min(${POPOVER_WIDTH}px, calc(100vw - ${POPOVER_MARGIN * 2}px))` }}
      >
        <header className="shrink-0 border-b border-stone-100 px-4 pb-2 pt-2.5 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <h2 id="notification-popover-title" className="text-base font-medium text-stone-900 dark:text-stone-100">{_('notificationDrawer.title')}</h2>
            {unreadCount > 0 && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-300">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            <button ref={closeRef} type="button" aria-label={_('notificationDrawer.close')} title={_('notificationDrawer.close')} onClick={onClose} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-4">
            <div className="flex items-center gap-4 text-sm">
              <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)} className={`border-b-2 pb-1 font-medium transition-colors ${!unreadOnly ? 'border-stone-900 text-stone-900 dark:border-stone-100 dark:text-stone-100' : 'border-transparent text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300'}`}>{_('notificationDrawer.all')}</button>
              <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)} className={`border-b-2 pb-1 font-medium transition-colors ${unreadOnly ? 'border-stone-900 text-stone-900 dark:border-stone-100 dark:text-stone-100' : 'border-transparent text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300'}`}>{_('notificationDrawer.unread')}</button>
            </div>
            {unreadCount > 0 && <button type="button" disabled={read.isPending} onClick={() => read.mutate({ all: true }, { onError: (error) => notify.error(getUserErrorNotification(error, 'notificationCenter.readFailed')) })} className="ml-auto text-xs text-stone-500 transition-colors hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-400 dark:hover:text-stone-100">{_('notificationCenter.readAll')}</button>}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={onListScroll} aria-busy={list.isPending || list.isFetchingNextPage}>
          {list.isPending ? <div role="status" className="space-y-3 p-4"><div className="h-20 animate-pulse rounded-xl bg-stone-500/10" /><div className="h-20 animate-pulse rounded-xl bg-stone-500/10" /></div>
            : list.isError ? <QueryErrorState className="px-4 py-8" isRetrying={list.isFetching} onRetry={() => void list.refetch()} />
              : entries.length === 0 ? <p role="status" className="px-4 py-12 text-center text-sm text-stone-500 dark:text-stone-400">{_(unreadOnly ? 'notificationDrawer.noUnread' : 'notificationDrawer.noNotifications')}</p>
                : <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                  {entries.map((entry) => <li key={entry.id} className={`relative px-4 py-3.5 transition-colors ${entry.readAt === null ? 'bg-stone-50/80 dark:bg-stone-800/35' : ''}`}>
                    <button type="button" onClick={() => openNotification(entry.id, entry.readAt)} className="block w-full pr-10 text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-stone-400">
                      <div className="flex items-start gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">{entry.actor.name.slice(0, 1).toUpperCase()}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-stone-900 dark:text-stone-100"><span className="font-semibold">{entry.actor.name}</span> {_(notificationActionKey(entry))}</p>
                          <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm text-stone-500 dark:text-stone-400">{entry.preview}</p>
                          <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{formatRelativeTime(_, entry.createdAt)}</p>
                        </div>
                      </div>
                    </button>
                    {entry.readAt === null && <span data-testid="notification-unread-dot" aria-label={_('notificationCenter.unread')} className="pointer-events-none absolute right-11 top-5 h-2 w-2 rounded-full bg-blue-500" />}
                    <button type="button" data-notification-menu aria-label={_('notificationDrawer.more')} title={_('notificationDrawer.more')} onClick={(event) => { event.stopPropagation(); setMenuId(menuId === entry.id ? null : entry.id) }} className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
                    </button>
                    {menuId === entry.id && <div data-notification-menu className="absolute right-3 top-10 z-10 min-w-24 rounded-lg border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"><button type="button" disabled={remove.isPending} onClick={() => deleteEntry(entry.id)} className="w-full rounded-md px-2.5 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30">{_('notificationDrawer.delete')}</button></div>}
                  </li>)}
                  {list.isFetchingNextPage && <li role="status" className="p-4 text-center text-xs text-stone-400">{_('notificationDrawer.loadingMore')}</li>}
                </ul>}
        </div>
      </aside>
      {selectedId && <NotificationDetailModal key={selectedId} notificationId={selectedId} entry={entries.find((entry) => entry.id === selectedId)} onClose={() => setSelectedId(null)} />}
    </>,
    document.body,
  )
}
