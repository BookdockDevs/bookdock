import { useId, useLayoutEffect, useRef, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { GroupLabel } from './ui'

/**
 * The description block, clamped to a readable height.
 * The old version scrolled a 160px box with a nested scrollbar, which hid the
 * rest of a long blurb behind a control nobody wants to fight with.
 *
 * Collapsed, the last line fades into the panel and the text itself is the
 * expand target: the fade already says there is more, so a chip on top of it
 * only repeats the message and covers the line the reader is squinting at.
 * The control appears on the heading row instead - the same slot, and the same
 * button, that collapses the blurb once expanded - so pointing at the text
 * never puts a control on top of type. The heading itself stays inert.
 */
export default function DescriptionSection({
  text,
  onEdit,
}: {
  text: string
  /** Right-click opens the single-field editor, as the metadata rows do. */
  onEdit?: () => void
}) {
  const _ = useTranslation()
  const textId = useId()
  const [expanded, setExpanded] = useState(false)
  const textRef = useRef<HTMLParagraphElement | null>(null)
  const [overflowed, setOverflowed] = useState(false)

  useLayoutEffect(() => {
    const el = textRef.current
    if (!el || expanded) return
    const measure = () => {
      const next = el.scrollHeight > el.clientHeight + 1
      setOverflowed((prev) => (prev === next ? prev : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  })

  const expandable = !expanded && overflowed

  function expand() {
    if (!expandable) return
    // Dragging across the text ends in a click on the same element; that click
    // is the end of a selection, not a request to expand.
    if (window.getSelection()?.toString()) return
    setExpanded(true)
  }

  return (
    <section
      className="group/desc mt-5"
      onContextMenu={onEdit
        ? (event) => {
            event.preventDefault()
            event.stopPropagation()
            onEdit()
          }
        : undefined}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <GroupLabel className="">{_('library.descriptionSection')}</GroupLabel>
        {expanded ? (
          <button
            type="button"
            aria-expanded
            aria-controls={textId}
            onClick={() => setExpanded(false)}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            {_('library.collapse')}
            <Chevron className="rotate-180" />
          </button>
        ) : expandable && (
          <button
            type="button"
            aria-expanded={false}
            aria-controls={textId}
            onClick={expand}
            className="pointer-events-none inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-stone-500 opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-stone-100 hover:text-stone-900 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/desc:pointer-events-auto group-hover/desc:opacity-100 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            {_('library.expand')}
            <Chevron />
          </button>
        )}
      </div>
      <div
        className={cn('relative', expandable && 'cursor-pointer')}
        onClick={expandable ? expand : undefined}
      >
        <p
          id={textId}
          ref={textRef}
          /*
           * Four lines of text-sm/leading-relaxed are 4 x 22.75px, so the
           * clamp is a max-height rather than line-clamp: line-clamp always
           * draws an ellipsis, which fights the fade under it. A plain overflow
           * cut ends on a clean line edge instead.
           */
          className={cn(
            'whitespace-pre-wrap text-sm leading-relaxed text-stone-600 dark:text-stone-300',
            !expanded && 'max-h-[5.6875rem] overflow-hidden',
          )}
        >
          {text}
        </p>
        {expandable && (
          /*
           * The fade is the "there is more" signal, so it stays shallow: it
           * only softens the bottom edge of the last line, which has to remain
           * readable - a taller, denser ramp swallowed that line whole. Its
           * colours mirror the dialog panel (bg-white / dark:bg-stone-900)
           * rather than a fixed white, and it drops pointer events so
           * right-click editing and text selection on the last line still
           * reach the text.
           */
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-white via-white/60 to-transparent dark:from-stone-900 dark:via-stone-900/60"
          />
        )}
      </div>
    </section>
  )
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
