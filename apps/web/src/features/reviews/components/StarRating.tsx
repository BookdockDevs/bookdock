import { useRef, useState } from 'react'

import { REVIEW_RATINGS } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

function StarPath({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('h-full w-full', filled ? 'fill-amber-400' : 'fill-stone-300 dark:fill-stone-600')}>
      <path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.57l-5.9 3.11 1.13-6.58L2.45 9.44l6.6-.96L12 2.5z" />
    </svg>
  )
}

function formatRatingValue(value: number | null, t: (key: string, options?: Record<string, string | number>) => string): string {
  if (value == null) return t('review.unrated')
  return t('review.ratingValue', { value: value.toFixed(1).replace(/\.0$/, '') })
}

export default function StarRating({
  value,
  onChange,
  size = 22,
  disabled = false,
  allowClear = true,
  label,
}: {
  /** 0.5–5 in half steps; null renders the unrated state. */
  value: number | null
  onChange?: (value: number | null) => void
  size?: number
  disabled?: boolean
  allowClear?: boolean
  /** Radiogroup label in input mode; accessible label in display mode. */
  label?: string
}) {
  const _ = useTranslation()
  const [hover, setHover] = useState<number | null>(null)
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([])

  if (!onChange) {
    if (value == null) {
      return <span className="text-xs text-stone-400 dark:text-stone-500">{_('review.unrated')}</span>
    }
    // Display mode may carry an explicit label (e.g. an approximated average)
    // so the announced value never contradicts a nearby exact number.
    const accessible = label ?? formatRatingValue(value, _)
    return (
      <span role="img" aria-label={accessible} title={accessible} className="inline-flex items-center gap-0.5">
        {REVIEW_RATINGS.filter((step) => Number.isInteger(step)).map((whole) => {
          const fill = Math.min(Math.max(value - (whole - 1), 0), 1)
          return (
            <span key={whole} className="relative inline-block" style={{ width: size, height: size }}>
              <StarPath filled={false} />
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <span className="block" style={{ width: size, height: size }}>
                  <StarPath filled />
                </span>
              </span>
            </span>
          )
        })}
      </span>
    )
  }

  // Roving tabindex: one Tab stop per group. Arrow keys move and select,
  // Home/End jump. Hover preview is mouse-only so keyboard focus never leaves
  // a stale fill behind.
  const focusValue = value != null && (REVIEW_RATINGS as readonly number[]).includes(value)
    ? value
    : REVIEW_RATINGS[0]!

  function moveFocus(from: number, delta: number) {
    if (disabled || !onChange) return
    const next = (from + delta + REVIEW_RATINGS.length) % REVIEW_RATINGS.length
    btnRefs.current[next]?.focus()
    onChange(REVIEW_RATINGS[next]!)
  }

  function handleGroupKeyDown(e: React.KeyboardEvent) {
    const active = btnRefs.current.findIndex((el) => el === document.activeElement)
    if (active < 0) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      moveFocus(active, 1)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      moveFocus(active, -1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      btnRefs.current[0]?.focus()
      if (!disabled && onChange) onChange(REVIEW_RATINGS[0]!)
    } else if (e.key === 'End') {
      e.preventDefault()
      btnRefs.current[REVIEW_RATINGS.length - 1]?.focus()
      if (!disabled && onChange) onChange(REVIEW_RATINGS[REVIEW_RATINGS.length - 1]!)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <div
        role="radiogroup"
        aria-label={label ?? _('review.rateAriaLabel')}
        className="inline-flex items-center gap-0.5"
        onMouseLeave={() => setHover(null)}
        onKeyDown={handleGroupKeyDown}
      >
        {[1, 2, 3, 4, 5].map((whole) => {
          const shownValue = hover ?? value ?? 0
          const leftFilled = shownValue >= whole - 0.5
          const rightFilled = shownValue >= whole
          return (
            <span key={whole} className="relative inline-block" style={{ width: size, height: size }}>
              <StarPath filled={false} />
              {leftFilled && (
                <span className="absolute inset-0 overflow-hidden" style={{ width: '50%' }}>
                  <span className="block" style={{ width: size, height: size }}>
                    <StarPath filled />
                  </span>
                </span>
              )}
              {rightFilled && (
                <span className="absolute inset-0 overflow-hidden" style={{ left: '50%', width: '50%' }}>
                  <span className="block" style={{ width: size, height: size, marginLeft: -size / 2 }}>
                    <StarPath filled />
                  </span>
                </span>
              )}
              <button
                type="button"
                role="radio"
                aria-checked={value === whole - 0.5}
                aria-label={formatRatingValue(whole - 0.5, _)}
                title={formatRatingValue(whole - 0.5, _)}
                disabled={disabled}
                tabIndex={disabled || (whole - 0.5) !== focusValue ? -1 : 0}
                ref={(el) => { btnRefs.current[(whole - 1) * 2] = el }}
                onMouseEnter={() => setHover(whole - 0.5)}
                onClick={() => onChange(whole - 0.5)}
                className="absolute inset-y-0 left-0 w-1/2 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400 disabled:cursor-default"
              />
              <button
                type="button"
                role="radio"
                aria-checked={value === whole}
                aria-label={formatRatingValue(whole, _)}
                title={formatRatingValue(whole, _)}
                disabled={disabled}
                tabIndex={disabled || whole !== focusValue ? -1 : 0}
                ref={(el) => { btnRefs.current[(whole - 1) * 2 + 1] = el }}
                onMouseEnter={() => setHover(whole)}
                onClick={() => onChange(whole)}
                className="absolute inset-y-0 right-0 w-1/2 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400 disabled:cursor-default"
              />
            </span>
          )
        })}
      </div>
      {allowClear && value != null && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className="ml-1 rounded px-1 py-0.5 text-[11px] text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
        >
          {_('review.clearRating')}
        </button>
      )}
    </div>
  )
}
