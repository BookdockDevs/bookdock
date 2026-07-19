import { useEffect, useRef, useState } from 'react'
import { t } from '@/i18n'
import { useToastStore } from '@/stores/toast.store'
import { useReaderState } from '../state/reader-state'
import { useAnnotations, useDeleteAnnotation, useUpdateAnnotation } from '../hooks/useAnnotations'
import { HIGHLIGHT_COLORS, popupPosition } from './annotation-colors'
import { BulbIcon, CheckIcon, CloseIcon, CopyIcon, TrashIcon } from './annotation-icons'

const POPUP_WIDTH = 300
const POPUP_HEIGHT = 260

const iconBtn = 'flex h-8 w-8 items-center justify-center rounded-full text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10'

export function AnnotationPopup({ bookId }: { bookId: string }) {
  const popup = useReaderState((s) => s.annotationPopup)
  const setAnnotationPopup = useReaderState((s) => s.setAnnotationPopup)
  const addToast = useToastStore((s) => s.addToast)
  const { data: annotations } = useAnnotations(bookId)
  const update = useUpdateAnnotation()
  const del = useDeleteAnnotation()
  const rootRef = useRef<HTMLDivElement>(null)

  const annotation = annotations?.data?.find((a) => a.cfiRange === popup?.cfiRange)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setEditing(!!popup?.editing)
    setDraft(annotation?.note ?? '')
    // Only reset when the popup target changes, not on every refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup?.cfiRange, popup?.editing])

  // Close on clicks outside the card (main window). In-content clicks are
  // relayed by Reader via the annotationPopup toggle / content-click handler.
  useEffect(() => {
    if (!popup) return
    function handle(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setAnnotationPopup(null)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [popup, setAnnotationPopup])

  if (!popup || !annotation || annotation.type === 'bookmark') return null

  async function changeColor(name: string) {
    if (!annotation || annotation.color === name) return
    try {
      await update.mutateAsync({ id: annotation.id, body: { color: name } })
    } catch {
      addToast(t().annotation.saveFailed, 'error')
    }
  }

  async function saveNote() {
    if (!annotation) return
    try {
      await update.mutateAsync({ id: annotation.id, body: { note: draft.trim() || undefined } })
      setEditing(false)
    } catch {
      addToast(t().annotation.saveFailed, 'error')
    }
  }

  async function remove() {
    if (!annotation) return
    try {
      await del.mutateAsync(annotation.id)
      addToast(t().reader.deleted, 'success')
    } catch {
      addToast(t().reader.deleteFailed, 'error')
    }
    setAnnotationPopup(null)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(annotation?.text ?? '')
      addToast(t().reader.copied, 'success')
    } catch {
      addToast(t().reader.copyFailed, 'error')
    }
  }

  const pos = popupPosition(popup.rect, POPUP_WIDTH, POPUP_HEIGHT)

  return (
    <div
      ref={rootRef}
      className="fixed z-50 flex w-[300px] flex-col gap-2 rounded-xl border p-3 shadow-lg backdrop-blur-md"
      style={{
        left: pos.left,
        top: pos.top,
        backgroundColor: 'var(--bd-read-bg)',
        borderColor: 'var(--bd-read-accent)',
        color: 'var(--bd-read-text)',
      }}
    >
      <blockquote
        className="max-h-24 overflow-y-auto rounded-lg px-2.5 py-2 text-xs leading-relaxed text-[var(--bd-read-sub)]"
        style={{ borderLeft: `3px solid ${HIGHLIGHT_COLORS.find((c) => c.name === annotation.color)?.hex ?? '#eab308'}`, backgroundColor: 'rgba(120,113,108,0.08)' }}
      >
        {annotation.text}
      </blockquote>

      <div className="flex items-center gap-0.5">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.name}
            onClick={() => changeColor(c.name)}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110"
            title={c.name}
          >
            <span
              className="h-3.5 w-3.5 rounded-full"
              style={{
                backgroundColor: c.hex,
                boxShadow: annotation.color === c.name ? `0 0 0 2px var(--bd-read-bg), 0 0 0 4px ${c.hex}` : undefined,
              }}
            />
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={copy} className={iconBtn} title={t().annotation.copy}><CopyIcon /></button>
        {!editing && (
          <button onClick={() => setEditing(true)} className={iconBtn} title={t().annotation.writeNote}><BulbIcon /></button>
        )}
        <button onClick={remove} className={`${iconBtn} text-red-500 hover:bg-red-500/10`} title={t().annotation.deleteHighlight}><TrashIcon /></button>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t().annotation.notePlaceholder}
            rows={3}
            className="w-full resize-none rounded-lg border border-stone-200/60 bg-transparent px-2.5 py-2 text-xs leading-relaxed outline-none placeholder:text-[var(--bd-read-sub)] dark:border-stone-800/60"
          />
          <div className="flex justify-end gap-1">
            <button onClick={() => setEditing(false)} className={iconBtn} title={t().annotation.cancel}><CloseIcon /></button>
            <button onClick={saveNote} className={`${iconBtn} text-emerald-500 hover:bg-emerald-500/10`} title={t().annotation.save}><CheckIcon /></button>
          </div>
        </div>
      ) : annotation.note ? (
        <button onClick={() => setEditing(true)} className="rounded-lg bg-stone-500/5 px-2.5 py-2 text-left text-xs leading-relaxed transition-colors hover:bg-stone-500/10">
          {annotation.note}
        </button>
      ) : null}
    </div>
  )
}
