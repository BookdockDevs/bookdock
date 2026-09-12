import { CloseIcon } from './annotation-icons'

interface AiChapterReferenceChipProps {
  title: string
  onActivate?: () => void
  onRemove?: () => void
  removeLabel?: string
  disabled?: boolean
  ariaLabel?: string
}

const CHIP_CLASS_NAME = 'flex min-h-8 max-w-full min-w-0 items-center gap-2 rounded-md border border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)] px-2 py-1 text-sm text-current'

export function ChapterReferenceIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5h8l4 4V20.5H6z" />
      <path d="M14 3.5v4h4M9 12h6M9 15.5h6" />
    </svg>
  )
}

export default function AiChapterReferenceChip({ title, onActivate, onRemove, removeLabel, disabled = false, ariaLabel }: AiChapterReferenceChipProps) {
  const content = <>
    <ChapterReferenceIcon />
    <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
    {onRemove && <button type="button" onClick={onRemove} aria-label={removeLabel ?? title} title={removeLabel ?? title} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"><CloseIcon /></button>}
  </>

  if (onActivate) {
    return <button type="button" disabled={disabled} onClick={onActivate} aria-label={ariaLabel ?? title} className={`${CHIP_CLASS_NAME} text-left transition-colors hover:bg-stone-500/15 hover:text-current disabled:cursor-default disabled:opacity-70`} data-testid="ai-chapter-reference-chip">
      {content}
    </button>
  }

  return <span className={CHIP_CLASS_NAME} data-testid="ai-chapter-reference-chip">
    {content}
  </span>
}
