import { useRef } from 'react'

import { CONTENT_FILES_MAX_COUNT, CONTENT_IMAGE_MAX_BYTES } from '@bookdock/shared'
import type { ContentFileUpload } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'

import type { ContentUploadEntry } from '../hooks/useContentDraft'

interface ContentUploadProps {
  /** Icon-only triggers for editor bottom bars; pills by default. */
  compact?: boolean
  inline?: boolean
  disabled?: boolean
  entries: ContentUploadEntry[]
  onAdd: (file: File, kind: ContentFileUpload['kind']) => void
  onRetry: (entry: ContentUploadEntry) => void
}

const compactButtonClassName =
  'min-h-8 min-w-8 rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200'

export function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  )
}

export default function ContentUpload({ compact = false, inline = false, disabled = false, entries, onAdd, onRetry }: ContentUploadProps) {
  const _ = useTranslation()
  const imageInput = useRef<HTMLInputElement>(null)
  function select(files: FileList | null) {
    if (!files) return
    const remaining = Math.max(0, CONTENT_FILES_MAX_COUNT - entries.length)
    if (files.length > remaining) notify.error({ key: 'contentFiles.tooMany' })
    for (const file of Array.from(files).slice(0, remaining)) {
      if (file.size > CONTENT_IMAGE_MAX_BYTES) {
        notify.error({ key: 'contentFiles.tooLarge' })
        continue
      }
      onAdd(file, 'image')
    }
  }
  const inputs = (
    <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label={_('contentFiles.addImage')} onChange={(event) => { select(event.target.files); event.target.value = '' }} />
  )
  const activeEntries = inline ? entries.filter((e) => e.status !== 'ready') : entries
  const entryList = activeEntries.length > 0 && (
    <div className={compact ? 'max-h-24 min-w-0 w-full basis-full overflow-y-auto' : 'min-w-0'}>
      {activeEntries.map((entry) => (
        <div key={entry.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs dark:bg-stone-800/50" role="status">
          <span className="min-w-0 flex-1 truncate" title={entry.file.name}>{entry.file.name}</span>
          {entry.status === 'uploading' ? <><progress className="h-1 w-16" max={100} value={entry.progress} aria-label={_('contentFiles.uploading')} /><span>{entry.progress === 100 ? _('contentFiles.processing') : `${entry.progress}%`}</span></> : entry.status === 'ready' ? <span className="text-stone-500">{_('contentFiles.ready')}</span> : <><span className="text-red-600 dark:text-red-400">{_('contentFiles.failed')}</span><Button variant="secondary" disabled={disabled} onClick={() => onRetry(entry)}>{_('contentFiles.retry')}</Button></>}
        </div>
      ))}
    </div>
  )
  if (compact) {
    return (
      <div className={inline ? 'contents' : 'flex min-w-0 flex-col gap-1'}>
        <div className="flex items-center gap-0.5">
          <button type="button" disabled={disabled} onClick={() => imageInput.current?.click()} title={_('contentFiles.addImage')} aria-label={_('contentFiles.addImage')} className={compactButtonClassName}>
            <ImageIcon />
          </button>
          {inline && activeEntries.some((e) => e.status === 'uploading') && (
            <span className="flex items-center pl-1 text-[11px] text-stone-400" role="status" title={_('contentFiles.uploading')}>
              <svg className="h-3.5 w-3.5 animate-spin text-stone-500" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
            </span>
          )}
          {!inline && <span className="ml-2 text-[11px] text-stone-400 dark:text-stone-500">{_('contentFiles.imageLimits')}</span>}
        </div>
        {inputs}
        {!inline && entryList}
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={disabled} onClick={() => imageInput.current?.click()}>{_('contentFiles.addImage')}</Button>
        <span className="text-xs text-stone-400">{_('contentFiles.imageLimits')}</span>
      </div>
      {inputs}
      {entries.map((entry) => (
        <div key={entry.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs dark:bg-stone-800/50" role="status">
          <span className="min-w-0 flex-1 truncate" title={entry.file.name}>{entry.file.name}</span>
          {entry.status === 'uploading' ? <><progress className="h-1 w-16" max={100} value={entry.progress} aria-label={_('contentFiles.uploading')} /><span>{entry.progress === 100 ? _('contentFiles.processing') : `${entry.progress}%`}</span></> : entry.status === 'ready' ? <span className="text-stone-500">{_('contentFiles.ready')}</span> : <><span className="text-red-600 dark:text-red-400">{_('contentFiles.failed')}</span><Button variant="secondary" disabled={disabled} onClick={() => onRetry(entry)}>{_('contentFiles.retry')}</Button></>}
        </div>
      ))}
    </div>
  )
}
