import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { useAiConfig } from '@/api/hooks/useAi'
import { useTranslationConfig } from '@/api/hooks/useTranslationConfig'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

import { useReaderApi } from '../hooks/useReaderApi'
import { markEscConsumed } from '../lib/esc-consumed'
import { useReaderState } from '../state/reader-state'
import type { SelectionInfo } from '../types'
import { CloseIcon, TranslateIcon } from './annotation-icons'
import { noteEditorPosition } from './note-editor-position'
import TranslationContent from './TranslationContent'

interface TranslationPopupProps {
  bookId: string
  target: SelectionInfo
}

export default function TranslationPopup({ bookId, target }: TranslationPopupProps) {
  const _ = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const mode = useUiStore((state) => state.readingMode)
  const user = useAuthStore((state) => state.user)
  const initialUserId = useRef(user?.id)
  const preferences = useTranslationConfig()
  const ai = useAiConfig()
  const { renderer } = useReaderApi()
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight, bounds: target.geometry?.bounds }))

  useEffect(() => {
    const close = () => useReaderState.getState().setTranslationTarget(null)
    const update = () => {
      const visual = window.visualViewport
      const reading = document.querySelector('[data-reader-viewport]')?.getBoundingClientRect()
      const left = Math.max(reading?.left ?? 0, visual?.offsetLeft ?? 0)
      const top = Math.max(reading?.top ?? 0, visual?.offsetTop ?? 0)
      const right = Math.min(reading?.right ?? window.innerWidth, (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth))
      const bottom = Math.min(reading?.bottom ?? window.innerHeight, (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight))
      setViewport({ width: window.innerWidth, height: window.innerHeight, bounds: { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) } })
    }
    const outside = (event: MouseEvent) => {
      const targetNode = event.target as Node | null
      if (root.current?.contains(targetNode)) return
      const targetElement = targetNode instanceof Element ? targetNode : targetNode?.parentElement
      if (targetElement?.closest('[data-reader-translation-popover]')) return

      event.preventDefault()
      event.stopPropagation()
      close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // If a translation popover (language menu or channel menu) is open, let that menu close first
      if (document.querySelector('[data-reader-translation-popover]')) return

      markEscConsumed()
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    update()
    window.addEventListener('click', outside, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    const unsubscribeRelocated = renderer?.on('relocated', close)
    const unsubscribeSelection = renderer?.on('textSelectionStart', close)
    return () => {
      window.removeEventListener('click', outside, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      unsubscribeRelocated?.()
      unsubscribeSelection?.()
    }
  }, [renderer])

  useEffect(() => {
    if (!user || user.id !== initialUserId.current) useReaderState.getState().setTranslationTarget(null)
  }, [user])

  const bounds = viewport.bounds ?? { left: 0, top: 0, width: viewport.width, height: viewport.height }
  const size = { width: Math.max(1, Math.min(420, bounds.width - 24)), height: Math.max(1, Math.min(250, bounds.height - 24)) }
  const position = noteEditorPosition(target.rect, mode, size, viewport, {
    rects: target.geometry?.rects ?? (target.rect ? [target.rect] : []),
    backward: target.geometry?.backward ?? false,
    focusX: target.geometry?.focusX ?? target.rect?.left ?? 0,
    ...target.geometry,
    bounds,
  })

  const hasData = Boolean(preferences.data && ai.data)
  const isError = Boolean(preferences.isError || ai.isError)

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={_('translation.title')}
      data-reader-modal
      data-reader-translation
      className="fixed z-[70]"
      style={{
        left: position.left,
        top: position.top,
        width: position.width ?? size.width,
        height: position.maxHeight ?? size.height,
        animation: 'note-editor-in 140ms ease-out forwards',
        '--note-dx': '0px',
        '--note-dy': position.placement === 'above' ? '8px' : '-8px',
      } as CSSProperties}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--bd-read-accent)]/80 bg-[var(--bd-read-bg)] text-[var(--bd-read-text)] shadow-lg">
        {hasData ? (
          <TranslationContent
            key={`${bookId}:${user?.id}`}
            bookId={bookId}
            text={target.rawText ?? target.text}
            preferences={preferences.data!.data}
            config={ai.data!.data}
            onClose={() => useReaderState.getState().setTranslationTarget(null)}
          />
        ) : (
          <>
            {/* Header stays intact during loading/error */}
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--bd-read-accent)]/40 px-4">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <TranslateIcon size={16} className="text-[var(--bd-read-primary)]" />
                <span>{_('translation.title')}</span>
              </span>
              <button
                type="button"
                aria-label={_('translation.close')}
                onClick={() => useReaderState.getState().setTranslationTarget(null)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--bd-read-sub)] hover:bg-stone-500/10"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Content area: Skeleton Loading or Error State */}
            {isError ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <p className="text-xs text-[var(--bd-read-sub)]">{_('translation.failed')}</p>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => { void preferences.refetch(); void ai.refetch() }}
                    className="rounded-lg border border-[var(--bd-read-accent)] px-3 py-1 text-xs text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10"
                  >
                    {_('translation.retry')}
                  </button>
                  <button
                    type="button"
                    onClick={() => useReaderState.getState().setTranslationTarget(null)}
                    className="rounded-lg px-3 py-1 text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10"
                  >
                    {_('translation.close')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col justify-center items-center gap-3 p-6 text-[var(--bd-read-sub)]">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin text-[var(--bd-read-primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <span className="text-xs">{_('translation.loading')}</span>
                </div>
                <div className="w-full max-w-xs space-y-2 pt-2 opacity-60">
                  <div className="h-2.5 w-3/4 rounded-full bg-stone-500/15 animate-pulse" />
                  <div className="h-2.5 w-full rounded-full bg-stone-500/10 animate-pulse" />
                  <div className="h-2.5 w-1/2 rounded-full bg-stone-500/15 animate-pulse" />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
