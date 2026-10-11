import { useRef } from 'react'

import { CONTENT_ATTACHMENT_MAX_BYTES, CONTENT_FILES_MAX_COUNT, CONTENT_IMAGE_MAX_BYTES } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'

import type { ContentUploadEntry } from '../hooks/useContentDraft'

interface ContentUploadProps {
  attachments?: boolean
  disabled?: boolean
  entries: ContentUploadEntry[]
  onAdd: (file: File, kind: 'image' | 'attachment') => void
  onRetry: (entry: ContentUploadEntry) => void
}

export default function ContentUpload({ attachments = false, disabled = false, entries, onAdd, onRetry }: ContentUploadProps) {
  const _ = useTranslation()
  const imageInput = useRef<HTMLInputElement>(null)
  const attachmentInput = useRef<HTMLInputElement>(null)
  function select(files: FileList | null, kind: 'image' | 'attachment') {
    if (!files) return
    const remaining = Math.max(0, CONTENT_FILES_MAX_COUNT - entries.length)
    if (files.length > remaining) notify.error({ key: 'contentFiles.tooMany' })
    for (const file of Array.from(files).slice(0, remaining)) {
      if (file.size > (kind === 'image' ? CONTENT_IMAGE_MAX_BYTES : CONTENT_ATTACHMENT_MAX_BYTES)) {
        notify.error({ key: 'contentFiles.tooLarge' })
        continue
      }
      onAdd(file, kind)
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={disabled} onClick={() => imageInput.current?.click()}>{_('contentFiles.addImage')}</Button>
        {attachments && <Button variant="secondary" disabled={disabled} onClick={() => attachmentInput.current?.click()}>{_('contentFiles.addAttachment')}</Button>}
        <span className="text-xs text-stone-400">{_(attachments ? 'contentFiles.reviewLimits' : 'contentFiles.imageLimits')}</span>
      </div>
      <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label={_('contentFiles.addImage')} onChange={(event) => { select(event.target.files, 'image'); event.target.value = '' }} />
      {attachments && <input ref={attachmentInput} type="file" accept=".pdf,.txt" multiple className="hidden" aria-label={_('contentFiles.addAttachment')} onChange={(event) => { select(event.target.files, 'attachment'); event.target.value = '' }} />}
      {entries.map((entry) => (
        <div key={entry.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs dark:bg-stone-800/50" role="status">
          <span className="min-w-0 flex-1 truncate" title={entry.file.name}>{entry.file.name}</span>
          {entry.status === 'uploading' ? <><progress className="h-1 w-16" max={100} value={entry.progress} aria-label={_('contentFiles.uploading')} /><span>{entry.progress === 100 ? _('contentFiles.processing') : `${entry.progress}%`}</span></> : entry.status === 'ready' ? <span className="text-stone-500">{_('contentFiles.ready')}</span> : <><span className="text-red-600 dark:text-red-400">{_('contentFiles.failed')}</span><Button variant="secondary" disabled={disabled} onClick={() => onRetry(entry)}>{_('contentFiles.retry')}</Button></>}
        </div>
      ))}
    </div>
  )
}
