import { Fragment, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'

import type { AnnotationRes } from '@bookdock/shared'

import { cn } from '@/lib/utils'

import { annotationHex, highlightDecoration } from './annotation-colors'

export type AnnotationTextTheme = 'reader' | 'app'

/**
 * Shared text rendering for annotation bodies (reader notes panel and
 * reading archive). Structure and measurement are identical; only the
 * surrounding theme differs. 'reader' keeps the reading-theme CSS variables
 * byte-identical, 'app' uses the stone app palette.
 */
function toggleClassName(theme: AnnotationTextTheme): string {
  return theme === 'reader'
    ? 'border-stone-200/80 bg-[var(--bd-read-bg)]/95 text-[var(--bd-read-sub)] dark:border-stone-700/80'
    : 'border-stone-200 bg-white/95 text-stone-500 dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-400'
}

function bodyTextClassName(theme: AnnotationTextTheme): string {
  return theme === 'reader' ? 'text-current' : 'text-stone-800 dark:text-stone-200'
}

/**
 * A clamped paragraph that only offers the expand toggle when it is genuinely
 * cut off.
 *
 * A character count cannot answer that. The panel is resizable and the reader
 * picks their own font and size, so the same 80 characters take two lines on a
 * wide panel and five on a narrow one. A count-only guess showed the toggle
 * no matter what, then expanded into
 * nothing but the padding reserved for the button. Only the rendered box knows,
 * so measure it and re-measure when it resizes.
 *
 * `minLengthForToggle` is the fallback for when no layout exists to measure
 * (JSDOM), and a cheap way to skip observing paragraphs that cannot overflow.
 */
export function ClampedText({
  text,
  clampClassName,
  className,
  wrapperClassName,
  renderText,
  expanded,
  onToggle,
  expandLabel,
  collapseLabel,
  minLengthForToggle,
  toggleClassName: extraToggleClassName,
  theme = 'reader',
  allowToggle = true,
}: {
  text: string
  clampClassName: string
  className: string
  /** Extra box treatment some call sites wrap the paragraph in. */
  wrapperClassName?: string
  /** Lets a call site decorate the text (a highlight's underline) without
   *  giving up the plain string the length check needs. */
  renderText?: (text: string) => ReactNode
  expanded: boolean
  onToggle: (e: MouseEvent) => void
  expandLabel: string
  collapseLabel: string
  minLengthForToggle: number
  /** Extra classes for the floating expand toggle (e.g. z-index above a stretched overlay button). */
  toggleClassName?: string
  theme?: AnnotationTextTheme
  /** False renders the full text with no toggle (archive browsing). */
  allowToggle?: boolean
}) {
  const ref = useRef<HTMLParagraphElement | null>(null)
  const [clipped, setClipped] = useState(false)
  const [measurable, setMeasurable] = useState(false)
  const couldOverflow = text.length > minLengthForToggle || text.includes('\n')
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n(?:[\t ]*\n)+/)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // JSDOM lays nothing out, so there is no answer to give. Report that
      // rather than claiming every box is unclipped.
      if (el.clientHeight === 0) return
      setMeasurable(true)
      setClipped(el.scrollHeight - el.clientHeight > 1)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded])

  const showToggle = allowToggle && couldOverflow && (measurable ? clipped || expanded : true)

  return (
    <div
      className={cn(
        'group/clamp relative min-w-0 flex-1',
        wrapperClassName,
      )}
    >
      <p ref={ref} className={cn(className, !expanded && clampClassName)}>
        {paragraphs.map((paragraph, paragraphIndex) => {
          const content = renderText ? paragraph.split('\n').map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {lineIndex > 0 && '\n'}
              {line.trim() ? renderText(line) : line}
            </Fragment>
          )) : paragraph
          return paragraphs.length === 1 ? content : (
            <span key={paragraphIndex} className="block [&+span]:mt-[0.4em]" data-note-paragraph>
              {content}
            </span>
          )
        })}
      </p>
      {showToggle && (
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'absolute bottom-1 right-1.5 inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] shadow-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-current max-md:opacity-100',
            toggleClassName(theme),
            extraToggleClassName,
          )}
        >
          <span>{expanded ? collapseLabel : expandLabel}</span>
          <svg
            className={cn('h-2.5 w-2.5 transition-transform duration-150', expanded && 'rotate-180')}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  )
}

/**
 * A highlight's quoted text with the same underline/tint it wears in the
 * book. Shared by the reader panel and the archive so colors never drift.
 */
export function HighlightQuote({
  item,
  expanded,
  onToggle,
  expandLabel,
  collapseLabel,
  theme = 'reader',
  allowToggle = true,
  toggleClassName,
  minLengthForToggle = 65,
}: {
  item: AnnotationRes
  expanded: boolean
  onToggle: (e: MouseEvent) => void
  expandLabel: string
  collapseLabel: string
  theme?: AnnotationTextTheme
  allowToggle?: boolean
  toggleClassName?: string
  minLengthForToggle?: number
}) {
  const hex = annotationHex(item.color)
  return (
    <ClampedText
      text={item.text}
      clampClassName="line-clamp-4"
      className={cn('text-sm leading-relaxed whitespace-pre-wrap break-words', item.style !== 'highlight' && 'pb-1', bodyTextClassName(theme))}
      renderText={(value) => <span style={highlightDecoration(item.style, hex)}>{value}</span>}
      expanded={expanded}
      onToggle={onToggle}
      expandLabel={expandLabel}
      collapseLabel={collapseLabel}
      minLengthForToggle={minLengthForToggle}
      toggleClassName={toggleClassName}
      theme={theme}
      allowToggle={allowToggle}
    />
  )
}
