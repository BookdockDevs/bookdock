import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

import type { AnnotationUpdateReq, ContentFile } from '@bookdock/shared'
import { CONTENT_IMAGE_MAX_BYTES, IDEA_IMAGE_MAX_COUNT } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import { useContentDraft, type ContentUploadEntry } from '../hooks/useContentDraft'
import ContentImagePreview from './ContentImagePreview'
import { ImageIcon } from './ContentUpload'

interface IdeaImageEditorProps {
  bookVersionId: string
  targetId?: string
  initialImages?: ContentFile[]
  disabled?: boolean
  showToolbar?: boolean
  onCountChange?: (count: number) => void
  onChange: (association: Pick<AnnotationUpdateReq, 'imageIds' | 'draftId'>, uploading: boolean) => void
}

export interface IdeaImageEditorHandle {
  addFiles: (files: File[]) => void
  openFilePicker: () => void
}

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

// Moments-style attachment row: text lives in the parent textarea above,
// images grid below. Uploading cells preview locally with progress; failed
// cells offer retry. Ready images detach with a hover close button — no
// filename rows or success banners.
const IdeaImageEditor = forwardRef<IdeaImageEditorHandle, IdeaImageEditorProps>(function IdeaImageEditor(
  { bookVersionId, targetId, initialImages = [], disabled, showToolbar = true, onCountChange, onChange },
  ref,
) {
  const _ = useTranslation()
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [imageOrder, setImageOrder] = useState(() => initialImages.map((image) => image.id))
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const change = useRef(onChange)
  const countChange = useRef(onCountChange)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  useEffect(() => { change.current = onChange }, [onChange])
  useEffect(() => { countChange.current = onCountChange }, [onCountChange])
  const draft = useContentDraft({ domain: 'idea', bookVersionId, targetId }, () => {})
  const uploadedImages = draft.entries.flatMap((entry) => entry.status === 'ready' && entry.resource ? [entry.resource] : [])
  const readyById = new Map([...initialImages, ...uploadedImages].map((image) => [image.id, image]))
  const removed = new Set(removedIds)
  const images = imageOrder.map((id) => readyById.get(id)).filter((image): image is ContentFile => image !== undefined && !removed.has(image.id))
  const pending = draft.entries.filter((entry) => entry.status !== 'ready' || !entry.resource)
  const totalCount = images.length + pending.length
  const uploadedImageIds = uploadedImages.map((image) => image.id).join('|')
  const removedImageIds = removedIds.join('|')
  const imageIds = images.map((image) => image.id)
  const imageIdsKey = imageIds.join('|')

  useEffect(() => {
    setImageOrder((current) => {
      const next = current.filter((id) => readyById.has(id) && !removed.has(id))
      for (const image of uploadedImages) if (!next.includes(image.id) && !removed.has(image.id)) next.push(image.id)
      return next
    })
  // The maps are derived from stable ids; only upload completion/removal should reconcile order.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedImageIds, removedImageIds])

  useEffect(() => {
    change.current({ imageIds: imageIdsKey ? imageIdsKey.split('|') : [], draftId: draft.draftId }, draft.uploading)
  }, [draft.draftId, draft.uploading, imageIdsKey])

  useEffect(() => {
    countChange.current?.(totalCount)
  }, [totalCount])

  const addFiles = useCallback((files: File[]) => {
    if (disabled || files.length === 0) return
    const remaining = Math.max(0, IDEA_IMAGE_MAX_COUNT - totalCount)
    if (files.length > remaining) notify.error({ key: 'contentFiles.ideaTooMany' })
    for (const file of files.slice(0, remaining)) {
      if (!IMAGE_MIME.has(file.type) || file.size > CONTENT_IMAGE_MAX_BYTES) {
        notify.error({ key: 'contentFiles.tooLarge' })
        continue
      }
      draft.add(file, 'image')
    }
  }, [disabled, draft, totalCount])
  const openFilePicker = useCallback(() => fileInputRef.current?.click(), [])
  useImperativeHandle(ref, () => ({ addFiles, openFilePicker }), [addFiles, openFilePicker])

  function detachImage(id: string) {
    if (disabled) return
    setRemovedIds((current) => current.includes(id) ? current : [...current, id])
    setImageOrder((current) => current.filter((imageId) => imageId !== id))
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (disabled || !over || active.id === over.id) return
    setImageOrder((current) => {
      const oldIndex = current.indexOf(String(active.id))
      const newIndex = current.indexOf(String(over.id))
      return oldIndex < 0 || newIndex < 0 ? current : arrayMove(current, oldIndex, newIndex)
    })
  }

  const showGrid = images.length > 0 || pending.length > 0

  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
      onDrop={(event) => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)) }}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
        if (files.length > 0) { event.preventDefault(); addFiles(files) }
      }}
    >
      {showGrid && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={images.map((image) => image.id)} strategy={rectSortingStrategy}>
            <div className="grid min-w-0 grid-cols-3 gap-2">
              {images.map((image, index) => (
                <SortableThumbnailCell key={image.id} image={image} disabled={disabled} onRemove={() => detachImage(image.id)} onPreview={() => setPreviewIndex(index)} removeLabel={_('contentFiles.remove')} />
              ))}
              {pending.map((entry) => (
                <PendingCell key={entry.id} entry={entry} disabled={disabled} onRetry={() => draft.retry(entry)} onDismiss={() => draft.dismiss(entry.id)} retryLabel={_('contentFiles.retry')} removeLabel={_('contentFiles.remove')} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {showToolbar && (
        <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
          <button
            type="button"
            disabled={disabled || totalCount >= IDEA_IMAGE_MAX_COUNT}
            onClick={openFilePicker}
            title={_('contentFiles.addImage')}
            aria-label={_('contentFiles.addImage')}
            className="rounded-full p-2 transition-colors hover:bg-stone-500/10 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-stone-200"
          >
            <ImageIcon />
          </button>
          <span className="tabular-nums">{totalCount} / {IDEA_IMAGE_MAX_COUNT}</span>
        </div>
      )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          aria-label={_('contentFiles.addImage')}
          disabled={disabled || totalCount >= IDEA_IMAGE_MAX_COUNT}
          onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }}
        />
      {previewIndex !== null && <ContentImagePreview images={images} initialIndex={previewIndex} onClose={() => setPreviewIndex(null)} />}
    </div>
  )
})

function SortableThumbnailCell({ image, disabled, onRemove, onPreview, removeLabel }: {
  image: ContentFile
  disabled?: boolean
  onRemove: () => void
  onPreview: () => void
  removeLabel: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} className={cn('group relative min-w-0 overflow-hidden rounded-lg border border-stone-200/70 dark:border-stone-800/70', isDragging && 'z-10 opacity-70 shadow-lg')}>
      <button type="button" onClick={(event) => { event.stopPropagation(); onPreview() }} className="block aspect-square w-full cursor-zoom-in">
        <img src={image.url} alt={image.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => { event.stopPropagation(); onRemove() }}
        title={removeLabel}
        aria-label={removeLabel}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-100 transition-colors hover:bg-black/80 disabled:cursor-not-allowed md:hidden md:group-hover:flex md:group-focus-within:flex"
      >
        ×
      </button>
    </div>
  )
}

function PendingCell({ entry, disabled, onRetry, onDismiss, retryLabel, removeLabel }: {
  entry: ContentUploadEntry
  disabled?: boolean
  onRetry: () => void
  onDismiss: () => void
  retryLabel: string
  removeLabel: string
}) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(entry.file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [entry.file])
  const failed = entry.status === 'failed'
  return (
    <div className="group relative min-w-0 overflow-hidden rounded-lg border border-stone-200/70">
      {preview && <img src={preview} alt={entry.file.name} className={cn('aspect-square w-full object-cover', failed && 'opacity-40')} />}
      {!failed && (
        <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/25" role="status">
          <div className="h-full rounded-full bg-white/90 transition-all" style={{ width: `${entry.status === 'ready' ? 100 : entry.progress}%` }} />
        </div>
      )}
      <div className="absolute right-1 top-1 flex items-center gap-1 md:hidden md:group-hover:flex md:group-focus-within:flex">
        {failed && (
          <button
            type="button"
            disabled={disabled}
            onClick={onRetry}
            title={retryLabel}
            aria-label={retryLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 disabled:cursor-not-allowed"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={onDismiss}
          title={removeLabel}
          aria-label={removeLabel}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 disabled:cursor-not-allowed"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default IdeaImageEditor
