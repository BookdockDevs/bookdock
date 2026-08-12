import { useTranslation } from '@/hooks/useTranslation'

/** Suspense fallback while the Reader chunk loads: without it the empty
 *  outlet shows the AppShell's light background — a white flash on first
 *  reader open per session */
export default function ReaderPending() {
  const _ = useTranslation()
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center"
      style={{ backgroundColor: 'var(--bd-read-page-bg)', color: 'var(--bd-read-text)' }}
    >
      <div className="flex flex-col items-center gap-2 text-sm text-[var(--bd-read-sub)]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
          <path d="M21 12a9 9 0 11-6.219-8.56" />
        </svg>
        {_('reader.loading')}
      </div>
    </div>
  )
}
