import { cn } from '@/lib/utils'

export function ReaderLoadingBadge({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-full bg-black/10 p-3 shadow-sm backdrop-blur-sm dark:bg-white/10', className)}
      aria-hidden="true"
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="animate-spin text-[var(--bd-read-sub)]"
      >
        <path d="M21 12a9 9 0 11-6.219-8.56" />
      </svg>
    </div>
  )
}

/** Suspense fallback while the Reader chunk loads: without it the empty
 *  outlet shows the AppShell's light background — a white flash on first
 *  reader open per session */
export default function ReaderPending() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="fixed inset-0 z-30 flex items-center justify-center"
      style={{ backgroundColor: 'var(--bd-read-page-bg)', color: 'var(--bd-read-text)' }}
    >
      <ReaderLoadingBadge />
    </div>
  )
}
