import type { AnnotationStyle } from '@bookdock/shared'

export function StyleGlyph({ style, active, color }: { style: AnnotationStyle; active?: boolean; color?: string }) {
  // Accent carries the annotation color so the marker tint follows the picked color
  const accent = color ?? 'currentColor'
  // Geometric 'A' drawn as a path: <text> renders blurry and font-dependent at this size
  if (style === 'highlight') {
    return (
      <svg viewBox="0 0 24 24" className={active ? 'text-amber-400' : undefined} width="20" height="20">
        <rect x="4.5" y="4.5" width="15" height="15" rx="3" fill={accent} />
        <path d="M8 16 12 8l4 8M9.4 13.2h5.2" fill="none" stroke="#292524" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  const line = style === 'squiggly'
    ? <path d="M4.5 20q1.9-2.5 3.75 0t3.75 0t3.75 0t3.75 0" fill="none" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
    : <path d="M4.5 20h15" fill="none" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
  return (
    <svg viewBox="0 0 24 24" className={active ? 'text-amber-400' : undefined} width="20" height="20">
      <path d="M6.5 15 12 4.5 17.5 15M8.9 10.7h6.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {line}
    </svg>
  )
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  )
}

export function BulbIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.3 1.1 2.2h5c.1-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

/** Replace glyph for the selection toolbar's 正文变换 action — a pencil
 *  rewriting two text lines (an edit/write gesture, distinct from the note
 *  bulb and the highlight "A") */
export function ReplaceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5h7" />
      <path d="M3.5 15.5h13" />
      <path transform="translate(1.5 -1) scale(0.85)" d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
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

export function SelectionIcon({ state = 'none' }: { state?: 'none' | 'partial' | 'all' }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      {state === 'all' && <path d="m7.5 12 3 3 6-6" />}
      {state === 'partial' && <path d="M7.5 12h9" />}
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

export function QuoteIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" stroke="none">
      <path d="M6 17h3l2-4V7H5v6h3l-2 4zm8 0h3l2-4V7h-6v6h3l-2 4z" />
    </svg>
  )
}

/** Opening-quote glyph (“) for idea cards. Shape pixel-traced from the 微信读书
 *  reference card (ball r15.5 + short tapered tail whose left edge is the
 *  tangent extension of the ball's left contour, native 72×53, IoU 0.90 vs ref);
 *  a font “ is too thin-stroked and a hand-drawn teardrop misses the geometry */
export function QuoteLeftIcon({ height = 24 }: { height?: number }) {
  return (
    <svg viewBox="0 0 72 53" width={(height * 72) / 53} height={height} fill="currentColor" stroke="none">
      <g>
        <circle cx="16" cy="37" r="15.5" />
        <path d="M2.2 30 L17 2.2 L20.2 3.4 C16.8 10 14 17 12.5 23.5 Z" />
      </g>
      <g transform="translate(40 0)">
        <circle cx="16" cy="37" r="15.5" />
        <path d="M2.2 30 L17 2.2 L20.2 3.4 C16.8 10 14 17 12.5 23.5 Z" />
      </g>
    </svg>
  )
}

export function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

export function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none">
      <path d="M6 2h12a2 2 0 012 2v18l-8-4-8 4V4a2 2 0 012-2z" />
    </svg>
  )
}

export function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M8 6.5 12 3l4 3.5" />
      <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  )
}

/** Card-with-quote glyph for the "书摘" (excerpt card) action — distinct from
 * the generic outbound ShareIcon used in the notes panel and dialog */
export function ExcerptShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <g fill="currentColor" stroke="none" transform="translate(3.9 5.6) scale(0.68)">
        <path d="M6 17h3l2-4V7H5v6h3l-2 4zm8 0h3l2-4V7h-6v6h3l-2 4z" />
      </g>
    </svg>
  )
}

export function TemplateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  )
}

export function DownloadIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7.5 11 12 15.5 16.5 11" />
      <path d="M4 19h16" />
    </svg>
  )
}

export function SpinnerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="animate-spin">
      <path d="M12 3a9 9 0 1 1-9 9" />
    </svg>
  )
}

export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  )
}

export function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
    </svg>
  )
}
