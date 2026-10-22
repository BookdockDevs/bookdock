import { Link } from '@tanstack/react-router'
import type { Ref } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import { useUnreadNotifications } from '../hooks'

interface NotificationBellProps { className?: string; buttonRef?: Ref<HTMLButtonElement>; onOpen?: () => void; open?: boolean }

export default function NotificationBell({ className, buttonRef, onOpen, open = false }: NotificationBellProps) {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
  const unread = useUnreadNotifications()
  if (!user) return null
  const hasUnread = (unread.data?.data.count ?? 0) > 0 && !unread.isError
  const content = <>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
    {hasUnread && <span data-testid="notification-unread-dot" aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />}
  </>
  const commonProps = { 'aria-label': _(hasUnread ? 'notificationCenter.unread' : 'notificationCenter.title'), title: _('notificationCenter.title'), className: cn('relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400', open && onOpen ? 'bg-stone-200/60 text-stone-900 dark:bg-stone-800 dark:text-stone-100' : 'text-stone-500 hover:bg-stone-500/10 dark:text-stone-400', className) }
  return onOpen
    ? <button ref={buttonRef} type="button" aria-expanded={open} aria-haspopup="dialog" onClick={onOpen} {...commonProps}>{content}</button>
    : <Link to="/notifications" search={{ page: 1 }} {...commonProps}>{content}</Link>
}
