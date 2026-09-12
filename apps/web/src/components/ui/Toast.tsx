import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'

const typeStyles = {
  success: {
    icon: 'text-emerald-600 dark:text-emerald-400',
    surface: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/70',
  },
  error: {
    icon: 'text-red-600 dark:text-red-400',
    surface: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/70',
  },
  info: {
    icon: 'text-blue-600 dark:text-blue-400',
    surface: 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/70',
  },
  warning: {
    icon: 'text-amber-600 dark:text-amber-400',
    surface: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/70',
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

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[200] flex flex-col items-stretch gap-2 sm:left-auto sm:right-6 sm:max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm text-stone-800 shadow-lg backdrop-blur-md dark:text-stone-100 ${typeStyles[toast.type].surface} animate-toast-in`}
          onPointerEnter={() => pauseToast(toast.id)}
          onPointerLeave={() => resumeToast(toast.id)}
          onFocus={() => pauseToast(toast.id)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resumeToast(toast.id)
          }}
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <ToastIcon type={toast.type} />
          <div className="min-w-0 flex-1">
            {toast.title && <p className="font-semibold">{toast.title}</p>}
            <p className="break-words leading-5">
              {typeof toast.message === 'string' ? toast.message : _(toast.message.key, toast.message.params)}
            </p>
            {toast.action && (
              <button
                type="button"
                className="mt-2 font-semibold underline underline-offset-2 hover:no-underline"
                onClick={() => {
                  toast.action?.onClick()
                  removeToast(toast.id)
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label={_('toast.dismiss')}
            className="-mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-black/5 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-stone-100"
            onClick={() => removeToast(toast.id)}
          >
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
      ))}
    </div>
  )
}
