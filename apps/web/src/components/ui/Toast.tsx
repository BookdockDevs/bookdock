import { useEffect, useRef } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'

import { Button } from './Button'

const typeStyles = {
  success: {
    icon: 'text-emerald-600 dark:text-emerald-400',
  },
  error: {
    icon: 'text-red-600 dark:text-red-400',
  },
  info: {
    icon: 'text-blue-600 dark:text-blue-400',
  },
  warning: {
    icon: 'text-amber-600 dark:text-amber-400',
  },
} as const

function ToastIcon({ type }: { type: keyof typeof typeStyles }) {
  const className = `h-5 w-5 shrink-0 ${typeStyles[type].icon}`
  if (type === 'success') {
    return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
  }
  if (type === 'error') {
    return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
  }
  if (type === 'warning') {
    return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4M12 17h.01" /></svg>
  }
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
}

export function Toast() {
  const _ = useTranslation()
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)
  const pauseToast = useToastStore((s) => s.pauseToast)
  const resumeToast = useToastStore((s) => s.resumeToast)
  const hostRef = useRef<HTMLDivElement>(null)
  const visible = toasts.length > 0

  useEffect(() => useAuthStore.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id) {
      useToastStore.getState().clearToasts()
    }
  }), [])

  useEffect(() => {
    const host = hostRef.current
    if (!visible || !host) return
    let frame = 0
    const observed = new Set<Element>()
    const recalibrate = () => {
      frame = 0
      const bounds = host.getBoundingClientRect()
      const obstacles = Array.from(document.querySelectorAll<HTMLElement>('[data-toast-obstacle]')).flatMap((element) =>
        element.dataset.toastObstacle === 'contents'
          ? Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
          : [element],
      )
      let clearance = 0
      for (const obstacle of obstacles) {
        const rect = obstacle.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight
          && rect.left < bounds.right && rect.right > bounds.left) {
          clearance = Math.max(clearance, window.innerHeight - rect.top + 12)
        }
        if (!observed.has(obstacle)) {
          resizeObserver?.observe(obstacle)
          observed.add(obstacle)
        }
      }
      for (const obstacle of observed) {
        if (!obstacles.includes(obstacle as HTMLElement)) {
          resizeObserver?.unobserve(obstacle)
          observed.delete(obstacle)
        }
      }
      host.style.setProperty('--bd-toast-clearance', `${clearance}px`)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(recalibrate)
    }
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    resizeObserver?.observe(host)
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-toast-obstacle'] })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    // Transformed reader controls settle after their visibility transition.
    document.addEventListener('transitionend', schedule)
    document.addEventListener('animationend', schedule)
    recalibrate()
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      document.removeEventListener('transitionend', schedule)
      document.removeEventListener('animationend', schedule)
    }
  }, [visible])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    for (const toast of toasts) {
      const card = [...host.querySelectorAll<HTMLElement>('[data-toast-id]')].find((element) => element.dataset.toastId === toast.id)
      if (card && !card.contains(document.activeElement)) resumeToast(toast.id, 'focus')
    }
  }, [resumeToast, toasts])

  if (toasts.length === 0) return null

  return (
    <div ref={hostRef} className="pointer-events-none fixed inset-x-4 bottom-[max(calc(1rem+env(safe-area-inset-bottom)),var(--bd-toast-clearance,0px))] z-[200] flex max-h-[min(50dvh,calc(100dvh-var(--bd-toast-clearance,0px)-2rem))] flex-col gap-2 overflow-y-auto overscroll-contain p-1 sm:left-auto sm:right-5 sm:w-[368px]">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-toast-id={toast.id}
          className="pointer-events-auto flex shrink-0 items-start gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 shadow-md shadow-stone-900/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:shadow-black/20 animate-toast-in"
          onPointerEnter={(event) => { if (event.pointerType !== 'touch') pauseToast(toast.id, 'pointer') }}
          onPointerLeave={() => resumeToast(toast.id, 'pointer')}
          onFocus={() => pauseToast(toast.id, 'focus')}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resumeToast(toast.id, 'focus')
          }}
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <ToastIcon type={toast.type} />
          <div className="min-w-0 flex-1">
            {toast.title && <p className="mb-1 font-semibold text-stone-900 [overflow-wrap:anywhere] dark:text-stone-100">{toast.title}</p>}
            <p className="leading-5 [overflow-wrap:anywhere]">
              {typeof toast.message === 'string' ? toast.message : _(toast.message.key, toast.message.params)}
            </p>
            {toast.action && !toast.action.icon && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 max-w-full whitespace-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                onClick={() => {
                  toast.action?.onClick()
                  if (!toast.action?.keepOpen) removeToast(toast.id)
                }}
              >
                {toast.action.label}
              </Button>
            )}
          </div>
          {[toast.secondaryAction, toast.action].filter((action): action is NonNullable<typeof action> => Boolean(action?.icon)).map((action, index) => {
            const icon = action.icon === 'loading' ? (
              <svg aria-hidden="true" className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.37 0 0 5.37 0 12h4Z" /></svg>
            ) : action.icon === 'retry' ? (
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.5-2L20 12M4 12l2.9 5a7 7 0 0 0 11.5-2" /></svg>
            ) : action.icon === 'undo' ? (
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-2" /></svg>
            ) : null
            const onClick = () => {
              action.onClick()
              if (!action.keepOpen) removeToast(toast.id)
            }

            if (action.icon === 'undo') {
              return (
                <button
                  key={`${action.icon}-${index}`}
                  type="button"
                  aria-label={action.label}
                  title={action.label}
                  disabled={action.disabled}
                  className="-my-1.5 -mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  onClick={onClick}
                >
                  {icon}
                </button>
              )
            }

            return (
              <Button
                key={`${action.icon}-${index}`}
                type="button"
                variant="secondary"
                size="sm"
                aria-label={action.label}
                title={action.label}
                disabled={action.disabled}
                className="-my-1.5 -mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                onClick={onClick}
              >
                {icon}
              </Button>
            )
          })}
          <button
            type="button"
            aria-label={_('toast.dismiss')}
            className="-my-1.5 -mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            onClick={() => removeToast(toast.id)}
          >
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
      ))}
    </div>
  )
}
