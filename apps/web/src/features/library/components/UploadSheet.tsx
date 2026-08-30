import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { Button } from '@/components/ui/Button'

import { useShelves, useTags, useUploadBooks, type UploadAssignment, type UploadItem } from '../hooks'

interface UploadSheetProps {
  open: boolean
  onClose: () => void
  shelfId?: string
  tagId?: string
}

function statusLabel(item: UploadItem): string | null {
  // Returns a translation key suffix (library.upload*) or null for transient states
  switch (item.status) {
    case 'pending':
      return 'uploadPending'
    case 'queued':
      return 'uploadQueued'
    case 'uploading':
      return 'uploading'
    case 'processing':
      return 'processing'
    case 'success':
      return 'uploadDone'
    case 'duplicate':
      return 'uploadDuplicate'
    case 'error':
      return null
  }
}

export default function UploadSheet({ open, onClose, shelfId, tagId }: UploadSheetProps) {
  const _ = useTranslation()
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [includeCurrentTag, setIncludeCurrentTag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { items, addFiles, startUpload, isUploading, clearQueue } = useUploadBooks()
  const { data: shelvesData } = useShelves()
  const { data: tagsData } = useTags()

  const shelfName = shelfId ? shelvesData?.data.find((shelf) => shelf.id === shelfId)?.name : undefined
  const tagName = tagId ? tagsData?.data.find((tag) => tag.id === tagId)?.name : undefined
  const assignment: UploadAssignment = {
    shelfId,
    tagIds: includeCurrentTag && tagId ? [tagId] : [],
  }

  // clearQueue keeps in-flight items, so closing mid-upload stays resumable
  const handleClose = useCallback(() => {
    clearQueue()
    onClose()
  }, [clearQueue, onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  useEffect(() => {
    if (!open) {
      setDragOver(false)
      setError(null)
    }
    setIncludeCurrentTag(false)
  }, [open, tagId])

  const hasPending = items.some((it) => it.status === 'pending')
  const settled = items.length > 0 && !isUploading && !hasPending

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={handleClose}
    >
      <div
        className="max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-stone-200 bg-white p-5 shadow-xl sm:max-h-none sm:overflow-visible sm:rounded-2xl sm:p-6 dark:border-stone-800 dark:bg-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
          {_('library.upload')}
        </h2>

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            setError(null)
            // Dropped files upload immediately on mouse release
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files, { autoStart: true, ...assignment })
          }}
          className={
            'flex h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed text-center transition-colors ' +
            (dragOver
              ? 'border-stone-900 bg-stone-50 dark:border-stone-300 dark:bg-stone-900/50'
              : 'border-stone-300 dark:border-stone-700')
          }
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <div className="space-y-2 text-center">
            <p className="text-sm text-stone-500">{_('library.uploadHint')}</p>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        {(shelfName || tagName) && (
          <div className="mt-4 space-y-2 rounded-xl bg-stone-50 px-3 py-2.5 text-xs text-stone-600 dark:bg-stone-900 dark:text-stone-300">
            {shelfName && <p>{_('library.uploadShelfContext', { name: shelfName })}</p>}
            {tagName && (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeCurrentTag}
                  onChange={(e) => setIncludeCurrentTag(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-stone-300 accent-stone-900 dark:border-stone-600 dark:accent-stone-100"
                />
                <span>{_('library.uploadTagContext', { name: tagName })}</span>
              </label>
            )}
          </div>
        )}

        {items.length > 0 && (
          <ul className="mt-4 max-h-52 space-y-2 overflow-y-auto pr-1">
            {items.map((item) => {
              const key = statusLabel(item)
              return (
                <li key={item.id} className="flex items-center gap-3 text-sm">
                  <span className="w-2 shrink-0 text-center">
                    {item.status === 'success' ? (
                      <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                    ) : item.status === 'duplicate' ? (
                      <span className="text-amber-600 dark:text-amber-400">↺</span>
                    ) : item.status === 'error' ? (
                      <span className="text-red-600 dark:text-red-400">✕</span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-300">{item.name}</span>
                  {key && (
                    <span className="shrink-0 text-xs text-stone-400">{_(`library.${key}`)}</span>
                  )}
                  {item.status === 'error' && (
                    <span className="shrink-0 text-xs text-red-600">{item.message}</span>
                  )}
                  {(item.status === 'uploading' || item.status === 'processing') && (
                    <span className="w-24 shrink-0">
                      <span className="block h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                        <span
                          className="block h-full rounded-full bg-stone-500 transition-all duration-200"
                          style={{ width: `${item.progress}%` }}
                        />
                      </span>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-6 flex justify-end gap-3">
          {settled ? (
            <>
              <Button variant="ghost" onClick={() => inputRef.current?.click()}>
                {_('library.selectFiles')}
              </Button>
              <Button onClick={handleClose}>{_('library.done')}</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={handleClose} disabled={isUploading}>
                {_('library.cancel')}
              </Button>
              {hasPending ? (
                <Button onClick={() => startUpload(assignment)}>{_('library.upload')}</Button>
              ) : (
                <Button onClick={() => inputRef.current?.click()}>{_('library.selectFiles')}</Button>
              )}
            </>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".epub,.txt"
          multiple
          className="hidden"
          onChange={(e) => {
            setError(null)
            // Picker-selected files wait for an explicit upload click
            if (e.target.files?.length) addFiles(e.target.files, assignment)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
