import type { AnnotationStyle } from '@bookdock/shared'

// Shared letter 'A' geometry across all styles: apex at (12, 5), feet at (7.5, 16.5) and (16.5, 16.5), bar at y=12.8
const A_GLYPH_PATH = 'M7.5 16.5 12 5l4.5 11.5M9 12.8h6'

export function StyleGlyph({
  style,
  active,
  color,
  className,
  size = 20,
}: {
  style: AnnotationStyle
  active?: boolean
  color?: string
  className?: string
  size?: number
}) {
  // If an explicit highlight color is given, use it for the marker tint / line
  const hasColor = Boolean(color)

  if (style === 'highlight') {
    if (hasColor) {
      return (
        <svg viewBox="0 0 24 24" className={className} width={size} height={size}>
          <rect x="4" y="3" width="16" height="16" rx="4.5" fill={color} />
          <path
            d={A_GLYPH_PATH}
            fill="none"
            stroke="#1c1917"
            strokeWidth={1.85}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    }

    if (active) {
      return (
        <svg viewBox="0 0 24 24" className={className} width={size} height={size}>
          <rect x="4" y="3" width="16" height="16" rx="4.5" fill="currentColor" />
          <path
            d={A_GLYPH_PATH}
            fill="none"
            stroke="var(--bd-read-bg, #ffffff)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    }

    return (
      <svg viewBox="0 0 24 24" className={className} width={size} height={size}>
        <rect
          x="4"
          y="3"
          width="16"
          height="16"
          rx="4.5"
          fill="currentColor"
          fillOpacity={0.12}
          stroke="currentColor"
          strokeWidth="1.2"
          strokeOpacity={0.35}
        />
        <path
          d={A_GLYPH_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  const lineStroke = hasColor ? color! : 'currentColor'

  if (style === 'underline') {
    return (
      <svg viewBox="0 0 24 24" className={className} width={size} height={size}>
        <path
          d={A_GLYPH_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={active ? 1.85 : 1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M4 20h16"
          fill="none"
          stroke={lineStroke}
          strokeWidth={active || hasColor ? 2.8 : 1.8}
          strokeLinecap="round"
        />
      </svg>
    )
  }

  // Squiggly
  return (
    <svg viewBox="0 0 24 24" className={className} width={size} height={size}>
      <path
        d={A_GLYPH_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 1.85 : 1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 20q2 -2.2 4 0t4 0t4 0t4 0"
        fill="none"
        stroke={lineStroke}
        strokeWidth={active || hasColor ? 2.6 : 1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}
export function CopyIcon({ size = 16, strokeWidth = 1.75, className }: { size?: number; strokeWidth?: number; className?: string } = {}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
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

export function AiChatIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11.5a8 8 0 0 1-8 8 8.3 8.3 0 0 1-3.5-.8L4 20l1.3-4A8 8 0 1 1 20 11.5Z" />
      <circle cx="8.5" cy="11" r=".7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r=".7" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="11" r=".7" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function AiSparkleIcon({ size = 20, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
      <path d="m19 15 .75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75z" />
    </svg>
  )
}

export function TtsIcon({
  size,
  className,
  strokeWidth = 1.8,
  viewBox = '0 0 24 24',
}: {
  size?: number
  className?: string
  strokeWidth?: number
  /** Crop tighter than 24x24 to optically upscale the glyph without redrawing its shape */
  viewBox?: string
} = {}) {
  return (
    <svg
      viewBox={viewBox}
      width={size ?? (className ? undefined : 20)}
      height={size ?? (className ? undefined : 20)}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.6 7 4.3 19.2M9.6 7l4.8 12.2M6.4 14.7h6" />
      <path d="M13.3 7.5c2.7 1.5 3.7 3.7 3.7 5.8M13.9 4.8c3.7 2.1 5.8 5 5.8 8.5" />
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

export function TrashIcon({
  size = 16,
  strokeWidth = 1.75,
  className,
}: {
  size?: number
  strokeWidth?: number
  className?: string
} = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

/** Replace glyph for the selection toolbar's 文本替换 action — opposing
 *  horizontal exchange arrows representing text replacement */
export function ReplaceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h15M15 4l4 4-4 4" />
      <path d="M20 16H5M9 12l-4 4 4 4" />
    </svg>
  )
}

export function CheckIcon({
  size = 18,
  strokeWidth = 1.8,
  className,
}: {
  size?: number
  strokeWidth?: number
  className?: string
} = {}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
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

export function CloseIcon({
  size = 16,
  strokeWidth = 1.75,
  className,
}: {
  size?: number
  strokeWidth?: number
  className?: string
} = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
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

export function SelectedPositionIcon({ size = 20 }: { size?: number } = {}) {
  return (
    <svg className="shrink-0" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="9" r="2.75" />
      <path d="M10.25 9c0 3.6-.7 6.1-2.8 9" />
      <circle cx="16.5" cy="9" r="2.75" />
      <path d="M19.25 9c0 3.6-.7 6.1-2.8 9" />
    </svg>
  )
}

/** Opening-quote glyph (“) for idea cards. The path stays inline so it scales
 * with the card's icon color. */
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

export function ChevronDownIcon({ size = 16, strokeWidth = 2, className }: { size?: number; strokeWidth?: number; className?: string } = {}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
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

export function ShareIcon({
  size = 16,
  strokeWidth = 1.75,
  className,
}: {
  size?: number
  strokeWidth?: number
  className?: string
} = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12M8 6.5 12 3l4 3.5" />
      <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  )
}

/** Double-quote glyph for the "书摘" (excerpt/quote card) action — clean linear
 *  outline quotation marks distinct from generic outbound share */
export function ExcerptShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 11H5.5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1H9a1 1 0 0 1 1 1v5.5c0 2.8-1.4 4.5-4.5 5.5" />
      <path d="M19.5 11H15a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1v5.5c0 2.8-1.4 4.5-4.5 5.5" />
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

export function BatchSelectIcon({ size = 18 }: { size?: number } = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 5 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="m3 12 2 2 4-4" />
      <path d="M13 13h8" />
      <path d="m3 19 2 2 4-4" />
      <path d="M13 20h8" />
    </svg>
  )
}

export function DocumentExportIcon({
  size = 16,
  strokeWidth = 1.75,
  className,
}: {
  size?: number
  strokeWidth?: number
  className?: string
} = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 18v-6" />
      <path d="m9 15 3 3 3-3" />
    </svg>
  )
}
