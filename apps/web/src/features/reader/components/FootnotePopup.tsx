import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { markEscConsumed } from '../lib/esc-consumed'
import { footnotePopupMaxHeight, footnotePopupPosition } from '../lib/footnote-popup'
import { useIsTouch } from '../hooks/useIsTouch'
import type { FootnoteEntry } from '../types'

interface FootnotePopupProps {
  entry: FootnoteEntry
  onBack: () => void
  onClose: () => void
}

export function FootnotePopup({ entry, onBack, onClose }: FootnotePopupProps) {
  const isTouch = useIsTouch()
  const contentRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const maxHeight = footnotePopupMaxHeight(viewport.height)
  const popupHeight = isTouch ? Math.min(520, viewport.height * 0.7) : maxHeight
  const width = Math.min(480, Math.max(0, viewport.width - 24))
  const position = footnotePopupPosition(entry.anchorRect, { width, height: maxHeight }, viewport)

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      markEscConsumed()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useLayoutEffect(() => {
    const host = contentRef.current
    if (!host) return
    host.replaceChildren(entry.view)
    entry.view.style.width = '100%'
    entry.view.style.height = '100%'
    return () => {
      if (entry.view.parentElement === host) host.removeChild(entry.view)
    }
  }, [entry])

  const label = entry.type === 'endnote' ? '尾注' : entry.type === 'footnote' ? '脚注' : '注释'

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <button
        type="button"
        aria-label="关闭脚注"
        className="pointer-events-auto absolute inset-0 cursor-default bg-black/10"
        onClick={onClose}
      />
      <section
        aria-label={label}
        data-testid="footnote-popup"
        className={`pointer-events-auto fixed flex flex-col overflow-hidden border shadow-2xl ${
          isTouch
            ? 'inset-x-2 bottom-2 max-h-[70dvh] rounded-2xl'
            : 'rounded-xl'
        }`}
        style={{
          ...(isTouch ? { height: popupHeight } : {
            left: position.left,
            top: position.top,
            width,
            height: maxHeight,
          }),
          backgroundColor: 'var(--bd-read-bg)',
          color: 'var(--bd-read-text)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-stone-500/15 px-3">
          <div className="flex min-w-0 items-center gap-2">
            {entry.canGoBack && (
              <button
                type="button"
                aria-label="返回上一个脚注"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current"
                onClick={onBack}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            )}
            <span className="truncate text-sm font-medium">{label}</span>
          </div>
          <button
            type="button"
            aria-label="关闭脚注"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div ref={contentRef} className="min-h-0 flex-1 overflow-auto" />
      </section>
    </div>
  )
}
