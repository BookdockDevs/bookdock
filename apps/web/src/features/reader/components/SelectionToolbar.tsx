import { useEffect, useState } from 'react'
import type { AnnotationRes, AnnotationStyle } from '@bookdock/shared'

import { t } from '@/i18n'
import { useToastStore } from '@/stores/toast.store'
import { useReaderState } from '../state/reader-state'
import { useReaderApi } from '../hooks/useReaderApi'
import { useAnnotations, useCreateAnnotation, useDeleteAnnotation, useUpdateAnnotation } from '../hooks/useAnnotations'
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_STYLES,
  getLastHighlightStyle,
  popupPosition,
  setLastHighlightStyle,
} from './annotation-colors'
import { BulbIcon, CopyIcon, SearchIcon, StyleGlyph, TrashIcon } from './annotation-icons'

const BAR_WIDTH = 176
const BAR_HEIGHT = 44
const STYLE_WIDTH = 236
const STYLE_HEIGHT = 40

const iconBtn = 'flex h-9 w-9 items-center justify-center rounded-full text-stone-200 transition-colors hover:bg-white/10 hover:text-white'

export function SelectionToolbar({ bookId }: { bookId: string }) {
  const selection = useReaderState((s) => s.selection)
  const setSelection = useReaderState((s) => s.setSelection)
  const setAnnotationPopup = useReaderState((s) => s.setAnnotationPopup)
  const setActiveNavTab = useReaderState((s) => s.setActiveNavTab)
  const setSidebarOpen = useReaderState((s) => s.setSidebarOpen)
  const setPendingSearchQuery = useReaderState((s) => s.setPendingSearchQuery)
  const { renderer } = useReaderApi()
  const addToast = useToastStore((s) => s.addToast)
  const create = useCreateAnnotation(bookId)
  const update = useUpdateAnnotation()
  const del = useDeleteAnnotation()
  const { data: annotations } = useAnnotations(bookId)

  const [createdLocal, setCreatedLocal] = useState<AnnotationRes | null>(null)
  useEffect(() => setCreatedLocal(null), [selection?.cfiRange])

  if (!selection || !selection.text) return null

  // Prefer fresh query data; fall back to the mutation snapshot before refetch lands
  const created = annotations?.data?.find((a) => a.id === createdLocal?.id) ?? createdLocal

  function close() {
    renderer?.clearSelection()
    setSelection(null)
  }

  async function highlight() {
    if (!selection) return
    const last = getLastHighlightStyle()
    try {
      const res = await create.mutateAsync({
        cfiRange: selection.cfiRange,
        cfiAnchor: selection.anchor,
        type: 'highlight',
        color: last.color,
        style: last.style,
        text: selection.text,
      })
      setCreatedLocal(res.data)
    } catch {
      addToast(t().annotation.saveFailed, 'error')
    }
  }

  async function restyle(patch: { color?: string; style?: AnnotationStyle }) {
    if (!created) return
    const color = patch.color ?? created.color
    const style = patch.style ?? created.style
    setLastHighlightStyle(color, style)
    setCreatedLocal({ ...created, color, style })
    try {
      await update.mutateAsync({ id: created.id, body: patch })
    } catch {
      addToast(t().annotation.saveFailed, 'error')
    }
  }

  async function removeHighlight() {
    if (!created) return
    try {
      await del.mutateAsync(created.id)
      setCreatedLocal(null)
    } catch {
      addToast(t().reader.deleteFailed, 'error')
    }
  }

  async function note() {
    if (!selection) return
    const last = getLastHighlightStyle()
    try {
      const res = await create.mutateAsync({
        cfiRange: selection.cfiRange,
        cfiAnchor: selection.anchor,
        type: 'note',
        color: last.color,
        style: last.style,
        text: selection.text,
      })
      const rect = selection.rect
      renderer?.clearSelection()
      setSelection(null)
      setAnnotationPopup({ cfiRange: res.data.cfiRange, rect, editing: true })
    } catch {
      addToast(t().annotation.saveFailed, 'error')
    }
  }

  async function copy() {
    if (!selection?.text) return
    try {
      await navigator.clipboard.writeText(selection.text)
      addToast(t().reader.copied, 'success')
    } catch {
      addToast(t().reader.copyFailed, 'error')
    }
  }

  function searchSelection() {
    if (!selection?.text) return
    setPendingSearchQuery(selection.text.slice(0, 50))
    setActiveNavTab('search')
    setSidebarOpen(true)
    close()
  }

  const bar = popupPosition(selection.rect, BAR_WIDTH, BAR_HEIGHT)
  // Style submenu: centered on the main bar, stacked directly above it
  const styleLeft = Math.min(
    Math.max(8, bar.left + BAR_WIDTH / 2 - STYLE_WIDTH / 2),
    Math.max(8, window.innerWidth - STYLE_WIDTH - 8),
  )
  const styleTop = Math.max(8, bar.top - STYLE_HEIGHT - 8)

  return (
    <>
      {created && (
        <div
          className="fixed z-50 flex h-10 items-center gap-0.5 rounded-2xl bg-stone-900/95 px-2 shadow-xl backdrop-blur-md"
          style={{ left: styleLeft, top: styleTop }}
        >
          {HIGHLIGHT_STYLES.map((s) => (
            <button key={s} onClick={() => restyle({ style: s })} className={iconBtn} title={s}>
              <StyleGlyph style={s} active={created.style === s} />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-white/15" />
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c.name} onClick={() => restyle({ color: c.name })} className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110" title={c.name}>
              <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ backgroundColor: c.hex }}>
                {created.color === c.name && (
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 13 4 4 10-10" />
                  </svg>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      <div
        className="fixed z-50 flex h-11 items-center gap-0.5 rounded-2xl bg-stone-900/95 px-2 shadow-xl backdrop-blur-md"
        style={{ left: bar.left, top: bar.top }}
      >
        <button onClick={copy} className={iconBtn} title={t().annotation.copy}><CopyIcon /></button>
        {created ? (
          <button onClick={removeHighlight} className={`${iconBtn} text-red-400 hover:text-red-300`} title={t().annotation.deleteHighlight}><TrashIcon /></button>
        ) : (
          <button onClick={highlight} className={iconBtn} title={t().annotation.drawHighlight}><StyleGlyph style={getLastHighlightStyle().style} /></button>
        )}
        <button onClick={note} className={iconBtn} title={t().annotation.writeNote}><BulbIcon /></button>
        <button onClick={searchSelection} className={iconBtn} title={t().reader.search}><SearchIcon /></button>
        <span
          className="absolute -bottom-1 h-3 w-3 rotate-45 bg-stone-900/95"
          style={{ left: bar.caretLeft - 6 }}
        />
      </div>
    </>
  )
}
