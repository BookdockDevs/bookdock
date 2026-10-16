import { useRef, useState } from 'react'

import type { AnnotationStyle } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import {
  COLOR_LABEL_KEYS,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_STYLES,
  STYLE_LABEL_KEYS,
} from '@/features/reader/components/annotation-colors'
import { CheckIcon, StyleGlyph } from '@/features/reader/components/annotation-icons'
import { useTranslation } from '@/hooks/useTranslation'
import { computeFromAnchor, PADDING, type SmartPosition } from '@/lib/position'
import { cn } from '@/lib/utils'

interface HighlightFilterMenuProps {
  colorFilter: Set<string>
  styleFilter: Set<AnnotationStyle>
  onToggleColor: (color: string) => void
  onToggleStyle: (style: AnnotationStyle) => void
  onReset: () => void
}

export default function HighlightFilterMenu({
  colorFilter,
  styleFilter,
  onToggleColor,
  onToggleStyle,
  onReset,
}: HighlightFilterMenuProps) {
  const _ = useTranslation()
  const [menu, setMenu] = useState<SmartPosition | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const isFiltered = colorFilter.size > 0 || styleFilter.size > 0
  const menuWidth = 248

  function toggle() {
    const anchor = anchorRef.current
    if (!anchor) return
    if (menu) {
      setMenu(null)
      return
    }
    const rect = anchor.getBoundingClientRect()
    const position = computeFromAnchor(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      menuWidth,
      190,
    )
    setMenu({
      ...position,
      left: Math.max(PADDING, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - PADDING)),
    })
  }

  return (
    <div ref={anchorRef} className="shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        title={_('annotation.filterStyle')}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
          isFiltered
            ? 'border-stone-400 bg-stone-100 text-stone-900 shadow-2xs dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100'
            : 'border-stone-200/90 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:text-stone-100',
        )}
      >
        {isFiltered && <span className="h-1.5 w-1.5 rounded-full bg-stone-900 dark:bg-stone-100" />}
        <span>{_('annotation.filterStyle')}</span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-stone-400"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {menu && (
        <SmartMenu
          innerRef={menuRef}
          triggerRef={anchorRef}
          position={menu}
          onClose={() => setMenu(null)}
          width={menuWidth}
          className="p-3"
        >
          <div className="space-y-3" role="dialog" aria-label={_('annotation.filterStyle')}>
            {/* 划线类型 */}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-stone-500 dark:text-stone-400">
                {_('annotation.filterStyle')}
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-500/10 p-1 dark:bg-stone-500/15">
                {HIGHLIGHT_STYLES.map((s) => {
                  const isActive = styleFilter.has(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onToggleStyle(s)}
                      title={_(STYLE_LABEL_KEYS[s])}
                      className={cn(
                        'flex h-7.5 items-center justify-center rounded-lg text-xs transition-all duration-150 select-none active:scale-[0.98]',
                        isActive
                          ? 'border border-black/8 bg-white font-semibold text-stone-900 shadow-xs dark:border-white/12 dark:bg-stone-800 dark:text-stone-100'
                          : 'text-stone-500 hover:bg-stone-500/5 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100',
                      )}
                    >
                      <StyleGlyph style={s} active={isActive} />
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 划线颜色 */}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-stone-500 dark:text-stone-400">
                {_('annotation.filterColor')}
              </div>
              <div className="flex items-center justify-between rounded-xl bg-stone-500/10 p-1.5 px-3 dark:bg-stone-500/15">
                {HIGHLIGHT_COLORS.map((c) => {
                  const isSelected = colorFilter.has(c.name)
                  return (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => onToggleColor(c.name)}
                      className={cn(
                        'relative flex h-6 w-6 items-center justify-center rounded-full transition-all duration-150 select-none',
                        isSelected
                          ? 'scale-110 shadow-xs ring-2 ring-stone-900 ring-offset-2 ring-offset-white dark:ring-stone-100 dark:ring-offset-stone-900'
                          : 'opacity-80 hover:scale-105 hover:opacity-100',
                      )}
                      style={{ backgroundColor: c.hex }}
                      title={_(COLOR_LABEL_KEYS[c.name])}
                      aria-label={_(COLOR_LABEL_KEYS[c.name])}
                      aria-pressed={isSelected}
                    >
                      {isSelected && (
                        <CheckIcon
                          size={12}
                          strokeWidth={2.6}
                          className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]"
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 底部重置操作栏 */}
            <div className="flex items-center justify-between border-t border-stone-200/60 pt-2.5 dark:border-stone-800/60">
              <div className="flex items-center gap-1.5 text-[11px]">
                {isFiltered && (
                  <span className="inline-flex items-center gap-1 font-medium text-stone-600 dark:text-stone-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-stone-600 dark:bg-stone-400" />
                    {_('annotation.filterActive')}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onReset}
                disabled={!isFiltered}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  isFiltered
                    ? 'text-stone-800 hover:bg-stone-500/10 active:scale-95 dark:text-stone-200'
                    : 'cursor-not-allowed text-stone-400/40 dark:text-stone-600',
                )}
              >
                {_('annotation.reset')}
              </button>
            </div>
          </div>
        </SmartMenu>
      )}
    </div>
  )
}
