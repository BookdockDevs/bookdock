import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import type { HighlightRuleDef } from '@bookdock/shared'

import { loadFoliateEngine } from '@/features/reader/content/load-engine'
import { HighlightEngine } from '@/features/reader/lib/highlight-engine'
import { highlightInkRange, type HighlightInkOverlay } from '@/features/reader/lib/highlight-render'
import { useTranslation } from '@/hooks/useTranslation'
import { computeHighlightSegments, HIGHLIGHT_LIMITS, type HighlightSegment } from '@/lib/highlight-match'

interface HighlightSamplePreviewProps {
  rule: HighlightRuleDef
  onChange: (sampleText: string) => void
}

interface PreviewInkOverlay extends HighlightInkOverlay {
  element: SVGSVGElement
  redraw(): void
}

// Both layers must wrap and size text identically so the native caret tracks
// the painted text, including after pasting multiline or tabbed samples.
const sampleLayout = 'm-0 min-h-20 w-full whitespace-pre-wrap break-words border-0 px-3 py-2 font-serif text-base leading-relaxed [tab-size:4] sm:text-sm'

export default function HighlightSamplePreview({ rule, onChange }: HighlightSamplePreviewProps) {
  const _ = useTranslation()
  const id = useId()
  const mirrorRef = useRef<HTMLDivElement>(null)
  const sample = rule.sampleText ?? ''
  const paragraphs = useMemo(() => sample.split('\n'), [sample])
  const [composing, setComposing] = useState(false)
  const [regexResult, setRegexResult] = useState<{ rule: HighlightRuleDef; segments: HighlightSegment[][] }>()

  useEffect(() => {
    if (!sample || !rule.pattern.trim() || !rule.isRegex) return
    const engine = new HighlightEngine()
    let disposed = false
    const timer = window.setTimeout(() => {
      const { sampleText: _sampleText, ...previewRule } = rule
      void engine.run(paragraphs, [previewRule]).then((segments) => {
        if (!disposed) setRegexResult({ rule, segments })
      })
    }, 80)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      engine.dispose()
    }
  }, [paragraphs, rule, sample])

  const matches = useMemo(() => {
    if (!sample || !rule.pattern.trim()) return []
    if (rule.isRegex) return regexResult?.rule === rule ? regexResult.segments : []
    return paragraphs.map((paragraph) => computeHighlightSegments(paragraph, [rule]))
  }, [paragraphs, regexResult, rule, sample])

  useEffect(() => {
    const mirror = mirrorRef.current
    if (!mirror || !matches.some((segments) => segments.some((segment) => segment.line))) return
    let disposed = false
    let overlay: PreviewInkOverlay | undefined
    let observer: ResizeObserver | undefined
    void loadFoliateEngine().then(({ Overlayer }) => {
      if (disposed) return
      const doc = mirror.ownerDocument
      const ink = matches.flatMap((segments, row) => segments.flatMap((segment, index) => {
        if (!segment.line) return []
        const text = mirror.querySelector(`[data-ink-index="${row}-${index}"]`)?.firstChild
        if (!text) return []
        const range = doc.createRange()
        range.selectNodeContents(text)
        const line = highlightInkRange(range, segment)
        return line ? [line] : []
      }))
      const instance = new Overlayer(doc, { relativeInk: true }) as PreviewInkOverlay
      overlay = instance
      mirror.append(instance.element)
      instance.setHighlightInk(ink)
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => instance.redraw())
        observer.observe(mirror)
      }
    }).catch(() => {})
    return () => {
      disposed = true
      observer?.disconnect()
      overlay?.setHighlightInk([])
      overlay?.element.remove()
    }
  }, [matches])

  const nodes: ReactNode[] = []
  paragraphs.forEach((paragraph, row) => {
    if (row > 0) nodes.push('\n')
    let cursor = 0
    for (const [index, segment] of (matches[row] ?? []).entries()) {
      if (segment.start > cursor) nodes.push(paragraph.slice(cursor, segment.start))
      const key = `${row}-${index}`
      nodes.push(
        <span
          key={key}
          data-ink-index={segment.line ? key : undefined}
          style={{ color: segment.textColor, backgroundColor: segment.backgroundColor }}
        >
          {paragraph.slice(segment.start, segment.end)}
        </span>,
      )
      cursor = segment.end
    }
    if (cursor < paragraph.length) nodes.push(paragraph.slice(cursor))
  })

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* self-start keeps the label box on the text: a stretched label makes the
          blank to its right focus the textarea when clicked. */}
      <label htmlFor={id} className="self-start text-xs font-medium text-current/80">
        {_('reader.themeHighlightLivePreview')}
      </label>
      <div className="relative min-w-0 rounded-xl border border-stone-300/70 bg-stone-500/5 focus-within:border-current/40 dark:border-stone-700/80">
        <div ref={mirrorRef} aria-hidden="true" className={`pointer-events-none relative ${sampleLayout} ${composing ? 'invisible' : ''}`}>
          {nodes}
          {sample.endsWith('\n') ? '\u200b' : null}
        </div>
        <textarea
          id={id}
          value={sample}
          rows={2}
          maxLength={HIGHLIGHT_LIMITS.maxSampleLength}
          spellCheck={false}
          placeholder={_('reader.themeHighlightLivePreviewHint')}
          onChange={(event) => onChange(event.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          className={`absolute inset-0 block h-full resize-none overflow-hidden rounded-xl bg-transparent caret-stone-900 outline-none placeholder:text-stone-500 selection:bg-sky-500/30 dark:caret-stone-100 dark:placeholder:text-stone-400 ${sampleLayout} ${composing ? 'text-current' : 'text-transparent selection:text-transparent'}`}
        />
      </div>
    </div>
  )
}
