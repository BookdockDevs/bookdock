import { useTranslation } from '@/hooks/useTranslation'

interface HistoryCapsuleProps {
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
}

const historyBtn =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-current transition-colors hover:bg-stone-500/10'

export default function HistoryCapsule({ canBack, canForward, onBack, onForward }: HistoryCapsuleProps) {
  const _ = useTranslation()
  if (!canBack && !canForward) return null
  return (
    <div className="absolute bottom-3 left-3 z-[60] flex h-11 items-center gap-0.5 rounded-full border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] px-1.5 shadow-xl transition-all duration-300 peer-hover/strip:bottom-[3.25rem]">
      {canBack && (
        <button onClick={onBack} title={_('reader.historyBack')} className={historyBtn}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
          </svg>
        </button>
      )}
      {canForward && (
        <button onClick={onForward} title={_('reader.historyForward')} className={historyBtn}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 14 5-5-5-5" />
            <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
          </svg>
        </button>
      )}
    </div>
  )
}
