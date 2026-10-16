import { useEffect, useRef, useState } from 'react'

import type { AnnotationUpdateReq, ContentFile } from '@bookdock/shared'

import IdeaImageEditor from '@/features/content-files/components/IdeaImageEditor'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { markEscConsumed } from '../lib/esc-consumed'
import type { AnnotationTextTheme } from './annotation-render'
import IdeaVisibilityControl from './IdeaVisibilityControl'

function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/** Inline card editor replacing the prompt-based rename: auto-growing
 *  textarea, Ctrl+Enter saves, Escape / outside click cancels (mirrors the
 *  selection-toolbar NoteEditorPopup interaction) */
export default function AnnotationInlineEditor({
  initial,
  placeholder,
  allowEmpty = false,
  saving,
  error,
  onSave,
  onCancel,
  visibilityEligible,
  sourceReadable,
  initialVisibility = 'private',
  bookVersionId, targetId, initialImages,
  theme = 'reader',
}: {
  initial: string
  placeholder: string
  allowEmpty?: boolean
  saving: boolean
  error: string | null
  onSave: (value: string, visibility?: 'private' | 'shared', files?: Pick<AnnotationUpdateReq, 'imageIds' | 'draftId'>) => void
  bookVersionId?: string
  targetId?: string
  initialImages?: ContentFile[]
  onCancel: () => void
  visibilityEligible?: boolean
  sourceReadable?: boolean
  initialVisibility?: 'private' | 'shared'
  theme?: AnnotationTextTheme
}) {
  const _ = useTranslation()
  const [draft, setDraft] = useState(initial)
  const [files, setFiles] = useState<Pick<AnnotationUpdateReq, 'imageIds' | 'draftId'>>()
  const [uploading, setUploading] = useState(false)
  const [visibility, setVisibility] = useState(initialVisibility)
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        markEscConsumed()
        if (!saving) onCancel()
      }
    }
    function onPointerDown(e: globalThis.MouseEvent) {
      if (!saving && rootRef.current && !rootRef.current.contains(e.target as Node)) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onPointerDown)
    textareaRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [onCancel, saving])

  function submit() {
    if (saving || uploading) return
    const value = draft.trim()
    if (value) onSave(value, visibilityEligible ? visibility : undefined, files)
    else if ((files?.imageIds?.length ?? 0) > 0) onSave('', visibilityEligible ? visibility : undefined, files)
    else if (allowEmpty && initial.trim()) onSave('')
    else onCancel()
  }

  const isChanged = draft.trim() !== initial.trim() || visibility !== initialVisibility
  const canSave = allowEmpty ? isChanged || (files?.imageIds?.length ?? 0) > 0 : Boolean(draft.trim()) || (files?.imageIds?.length ?? 0) > 0

  return (
    <div ref={rootRef} className="p-3" onContextMenu={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        rows={1}
        value={draft}
        disabled={saving}
        onChange={(e) => {
          setDraft(e.target.value)
          autoGrow(e.target)
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            if (!saving) onCancel()
          }
        }}
        placeholder={placeholder}
        className={cn(
          'w-full resize-none bg-transparent text-sm leading-relaxed outline-none',
          theme === 'reader'
            ? 'text-current placeholder:text-[var(--bd-read-sub)]'
            : 'text-stone-800 placeholder:text-stone-400 dark:text-stone-200',
        )}
      />
      {bookVersionId && <IdeaImageEditor bookVersionId={bookVersionId} targetId={targetId} initialImages={initialImages} disabled={saving} onChange={(next, pending) => { setFiles(next); setUploading(pending) }} />}
      {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {visibilityEligible && <IdeaVisibilityControl value={visibility} onChange={setVisibility} sourceReadable={sourceReadable ?? false} disabled={saving} />}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          disabled={saving}
          onClick={onCancel}
          className={cn(
            'rounded-md px-2 py-1 text-xs transition-colors hover:bg-stone-500/10 hover:text-current',
            theme === 'reader' ? 'text-[var(--bd-read-sub)]' : 'text-stone-500 dark:text-stone-400',
          )}
        >
          {_('annotation.cancel')}
        </button>
        <button
          onClick={submit}
          disabled={saving || uploading || !canSave}
          className="rounded-md bg-blue-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-60"
        >
          {_('annotation.save')}
        </button>
      </div>
    </div>
  )
}
