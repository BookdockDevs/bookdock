import { useEffect, useRef, useState } from 'react'

import type { AnnotationUpdateReq, ContentFile } from '@bookdock/shared'
import { IDEA_IMAGE_MAX_COUNT } from '@bookdock/shared'

import { ImageIcon } from '@/features/content-files/components/ContentUpload'
import IdeaImageEditor, { type IdeaImageEditorHandle } from '@/features/content-files/components/IdeaImageEditor'
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
  const imageEditorRef = useRef<IdeaImageEditorHandle>(null)
  const [imageCount, setImageCount] = useState(initialImages?.length ?? 0)

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
      {bookVersionId && <IdeaImageEditor ref={imageEditorRef} bookVersionId={bookVersionId} targetId={targetId} initialImages={initialImages} disabled={saving} showToolbar={false} onCountChange={setImageCount} onChange={(next, pending) => { setFiles(next); setUploading(pending) }} />}
      {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className={cn(
        'mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5',
        theme === 'reader' ? 'border-[var(--bd-read-accent)]/25' : 'border-stone-200 dark:border-stone-800',
      )}>
        {(visibilityEligible || bookVersionId) && <div className="flex min-w-0 items-center gap-3">
          {visibilityEligible && <IdeaVisibilityControl value={visibility} onChange={setVisibility} sourceReadable={sourceReadable ?? false} disabled={saving} />}
          {bookVersionId && <div className={cn('flex shrink-0 items-center gap-1 text-xs', theme === 'reader' ? 'text-[var(--bd-read-sub)]' : 'text-stone-500 dark:text-stone-400')}>
            <button
              type="button"
              disabled={saving || uploading || imageCount >= IDEA_IMAGE_MAX_COUNT}
              onClick={() => imageEditorRef.current?.openFilePicker()}
              title={_('contentFiles.addImage')}
              aria-label={_('contentFiles.addImage')}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ImageIcon />
            </button>
            <span className="whitespace-nowrap tabular-nums">{imageCount} / {IDEA_IMAGE_MAX_COUNT}</span>
          </div>}
        </div>}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-stone-500/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40',
              theme === 'reader' ? 'text-[var(--bd-read-sub)]' : 'text-stone-500 dark:text-stone-400',
            )}
          >
            {_('annotation.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || uploading || !canSave}
            className={cn(
              'rounded-full px-5 py-1.5 text-sm font-medium shadow-xs transition-all enabled:cursor-pointer enabled:hover:opacity-90 enabled:active:scale-95 disabled:cursor-not-allowed',
              saving || uploading || !canSave
                ? 'bg-stone-200 text-stone-400 opacity-60 dark:bg-stone-800 dark:text-stone-500'
                : theme === 'reader'
                  ? 'bg-[var(--bd-read-primary)] text-white'
                  : 'bg-stone-900 text-white dark:bg-white dark:text-stone-900',
            )}
          >
            {_('annotation.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
