import type { AnnotationStyle } from '@bookdock/shared'

export const iconBtn = 'flex h-9 w-9 items-center justify-center rounded-full transition-colors'

export function StyleGlyph({ style, active }: { style: AnnotationStyle; active?: boolean }) {
  const line = style === 'squiggly'
    ? <path d="M5 19 q2 -2.5 3.5 0 t3.5 0 t3.5 0 t3.5 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    : style === 'highlight'
      ? <rect x="4" y="15" width="16" height="5" rx="1" fill="currentColor" opacity="0.45" />
      : <line x1="5" y1="19" x2="19" y2="19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  return (
    <svg viewBox="0 0 24 24" className={active ? 'text-amber-400' : undefined} width="22" height="22">
      <text x="12" y="15" textAnchor="middle" fontSize="13" fill="currentColor" fontFamily="serif">A</text>
      {line}
    </svg>
  )
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  )
}

export function BulbIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.3 1.1 2.2h5c.1-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 13 4 4 10-10" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
