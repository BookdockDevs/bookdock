import { useToastStore } from '@/stores/toast.store'

export function Toast() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] px-4 py-2.5 text-sm font-medium text-[var(--bd-read-text)] shadow-lg backdrop-blur-md transition-all"
          onClick={() => removeToast(toast.id)}
          role="alert"
        >
          {toast.message}
        </div>
      ))}
    </div>
  )
}
