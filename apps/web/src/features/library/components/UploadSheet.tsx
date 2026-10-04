import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'

import { useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { formatBytes } from '@/lib/utils'

import { useShelves, useTags, useUploadBooks, useUploadSettings, type UploadAssignment, type UploadItem, type UploadTarget } from '../hooks'

interface UploadSheetProps {
  open: boolean
  onClose: () => void
  shelfId?: string
  /**
   * Explicit name of the shelf or category in context. If omitted, looked up
   * from shelfId in the private library's shelves.
   */
  shelfName?: string
  /** Whether the destination is a category (shared library) or a shelf (private). */
  isCategory?: boolean
  tagId?: string
  /**
   * Where the files go. Omitted means the reader's own library, which is the
   * default everywhere; a shared library passes its catalog endpoint and gets
   * this same window, queue and progress bar rather than a second one.
   */
  target?: UploadTarget
  /**
   * Version-name mode (P3): each queued file gets an edition-label input that
   * rides along as the upload's `name` field. Only meaningful with a catalog
   * target already bound to one work.
   */
  versionNameMode?: boolean
  /** Upload target is already bound to an existing work: prevents navigating to reading directly. */
  boundWork?: boolean
  /** One-line context under the dropzone, e.g. which work new versions join. */
  contextNote?: string
  /** Optional hover title for contextNote */
  contextTitle?: string
  /** Fired once per settle cycle with the ids the server answered. */
  onUploaded?: (ids: string[]) => void
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
    case 'corresponding':
      return null
  }
}

function hasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return Boolean(e.dataTransfer?.types.includes('Files'))
}

export default function UploadSheet({
  open,
  onClose,
  shelfId,
  shelfName: propShelfName,
  isCategory = false,
  tagId,
  target,
  versionNameMode = false,
  boundWork,
  contextNote,
  contextTitle,
  onUploaded,
}: UploadSheetProps) {
  const _ = useTranslation()
  const [dragOver, setDragOver] = useState(false)
  const [includeCurrentTag, setIncludeCurrentTag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { items, addFiles, startUpload, retry, retryAll, continueUpload, abortAll, pruneSettled, isUploading, clearQueue } = useUploadBooks(target)
  const reportedRef = useRef('')
  const { maxBytes, normalizeTitle } = useUploadSettings()
  const { data: shelvesData } = useShelves()
  const { data: tagsData } = useTags()

  const shelfName = propShelfName ?? (shelfId ? shelvesData?.data.find((shelf) => shelf.id === shelfId)?.name : undefined)
  const contextTooltip = isCategory
    ? _('library.uploadCategoryContext', { name: shelfName ?? '' })
    : _('library.uploadShelfContext', { name: shelfName ?? '' })
  const tagName = tagId ? tagsData?.data.find((tag) => tag.id === tagId)?.name : undefined
  const assignment: UploadAssignment = {
    shelfId: shelfId,
    tagIds: includeCurrentTag && tagId ? [tagId] : [],
  }

  // clearQueue keeps in-flight items, so closing mid-upload stays resumable
  const handleClose = useCallback(() => {
    clearQueue()
    onClose()
  }, [clearQueue, onClose])

  useEffect(() => {
    if (!open) {
      setDragOver(false)
    }
    setIncludeCurrentTag(false)
  }, [open, tagId])

  // The auto drag-toggle can close the sheet without clearQueue, so finished
  // rows must be pruned on (re)open instead of lingering as stale "done" items.
  useEffect(() => {
    if (open) pruneSettled()
  }, [open, pruneSettled])

  // The whole sheet accepts file drops: the global drag listener opens it
  // wherever the pointer is, so a release outside the small dropzone must not
  // silently swallow the files. Only the backdrop carries the handlers;
  // drops on the panel/dropzone bubble into this one path.
  function acceptDrop(e: ReactDragEvent) {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) {
      addFiles(e.dataTransfer.files, {
        autoStart: true,
        maxBytes,
        ...(versionNameMode && normalizeTitle ? { versionNameMode: true } : {}),
        ...assignment,
      })
    }
  }

  const hasPending = items.some((it) => it.status === 'pending')
  const settled = items.length > 0 && !isUploading && !hasPending
  const failed = items.filter((it) => it.status === 'error').length

  // Report fresh successes once per settle cycle so an uploader into an
  // existing work can select the version it just added.
  useEffect(() => {
    if (!onUploaded || !settled) return
    const ids = items.filter((it) => it.status === 'success' && it.bookVersionId).map((it) => it.bookVersionId as string)
    if (ids.length === 0 || ids.join(',') === reportedRef.current) return
    reportedRef.current = ids.join(',')
    onUploaded(ids)
  }, [settled, items, onUploaded])
  // One finished book is worth opening straight away: closing this window and
  // hunting the book back out of the grid is the longer path to the same read.
  // Version-name uploads are the exception: their picked id is a version link,
  // not a readable book, and the caller selects it into the open dialog via
  // onUploaded instead of navigating.
  const readable = settled && items.length === 1
    && (items[0].status === 'success' || items[0].status === 'duplicate')
    && Boolean(items[0].bookVersionId)
    && !(boundWork ?? versionNameMode)

  function handleRead() {
    const bookVersionId = items[0]?.bookVersionId
    if (!bookVersionId) return
    clearQueue()
    onClose()
    void navigate({ to: '/books/$id', params: { id: bookVersionId } })
  }

  if (!open) return null

  return (
    <Modal
      title={(
        <div className="flex items-center gap-2">
          <span>{_('library.upload')}</span>
          {shelfName && (
            <span
              title={contextTooltip}
              className="inline-flex max-w-[180px] items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-normal text-stone-600 dark:bg-stone-800 dark:text-stone-300"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="truncate">{shelfName}</span>
              <span className="sr-only">{contextTooltip}</span>
            </span>
          )}
          {tagName && (
            <label
              className={`inline-flex max-w-[160px] cursor-pointer items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-normal transition-colors ${
                includeCurrentTag
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                  : 'border border-dashed border-stone-300 text-stone-500 hover:border-stone-400 dark:border-stone-700 dark:text-stone-400'
              }`}
              title={_('library.uploadTagContext', { name: tagName })}
            >
              <input
                type="checkbox"
                checked={includeCurrentTag}
                onChange={(e) => setIncludeCurrentTag(e.target.checked)}
                className="sr-only"
                aria-label={_('library.uploadTagContext', { name: tagName })}
              />
              <span className="text-[11px] opacity-70">#</span>
              <span className="truncate">{tagName}</span>
            </label>
          )}
          {contextNote && (
            <span
              className="inline-flex max-w-[200px] items-center rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-normal text-stone-600 dark:bg-stone-800 dark:text-stone-300"
              title={contextTitle ?? contextNote}
            >
              <span className="truncate">{contextNote}</span>
            </span>
          )}
        </div>
      )}
      onClose={handleClose}
      // The default reads "cancel", which now collides with the footer's
      // cancel-upload: here closing the window is not cancelling anything.
      closeLabel={_('library.close')}
      size="default"
      containerProps={{
        onDragOver: (e) => {
          if (hasFiles(e)) e.preventDefault()
        },
        onDrop: acceptDrop,
      }}
    >
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          // dragleave bubbles from child nodes; only clear when the pointer
          // actually left the dropzone, otherwise the highlight flickers
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDragOver(false)
        }}
        className={
          'group flex h-60 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed text-center transition-all duration-150 ' +
          (dragOver
            ? 'border-stone-500 bg-stone-100/80 dark:border-stone-400 dark:bg-stone-800/60'
            : 'border-stone-300 hover:border-stone-400 hover:bg-stone-50/50 dark:border-stone-700 dark:hover:border-stone-600 dark:hover:bg-stone-800/30')
        }
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-500 transition-transform duration-200 group-hover:scale-105 dark:bg-stone-800 dark:text-stone-400">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-stone-700 dark:text-stone-300">{_('library.uploadHint')}</p>
          <div className="mt-2 flex items-center justify-center gap-1.5">
            <span className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              EPUB
            </span>
            <span className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              TXT
            </span>
          </div>
          {maxBytes && (
            <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
              {_('library.uploadMaxSize', { size: formatBytes(maxBytes) })}
            </p>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <ul data-toast-obstacle="" className="mt-4 max-h-56 space-y-2 overflow-y-auto pr-1">
          {items.map((item) => {
            const key = statusLabel(item)
            const note = item.messageKey ? _(item.messageKey) : null
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl bg-stone-50 px-3 py-2 text-xs dark:bg-stone-800/60"
              >
                <span className="shrink-0">
                  {item.status === 'success' ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-400">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : item.status === 'duplicate' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 dark:text-amber-400">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                  ) : item.status === 'error' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-600 dark:text-red-400">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-300">{item.name}</span>
                {item.status === 'corresponding' ? (
                  <>
                    <span className="min-w-0 text-amber-600 dark:text-amber-400">
                      {_('library.uploadCorresponding', { title: item.corresponding?.title ?? '' })}
                    </span>
                    <button type="button" onClick={() => continueUpload(item.id)}
                      className="shrink-0 font-medium underline underline-offset-2">
                      {_('library.uploadContinue')}
                    </button>
                  </>
                ) : item.status === 'error' ? (
                  <>
                    {note && <span className="shrink-0 text-xs text-red-600 dark:text-red-400">{note}</span>}
                    <button
                      type="button"
                      onClick={() => retry(item.id)}
                      className="shrink-0 text-xs font-medium text-stone-600 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
                    >
                      {_('library.uploadRetry')}
                    </button>
                  </>
                ) : (
                  key && (
                    <span
                      className={
                        'shrink-0 text-xs ' +
                        (item.status === 'duplicate' && note
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-stone-400')
                      }
                    >
                      {note ?? _(`library.${key}`)}
                    </span>
                  )
                )}
                {(item.status === 'uploading' || item.status === 'processing') && (
                  <span className="w-24 shrink-0">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                      <span
                        className="block h-full rounded-full bg-stone-800 transition-all duration-200 dark:bg-stone-200"
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

      {/* One action per state, and nothing at all while the queue is empty:
          the close affordance is the header X, and adding files is the drop
          zone above, which is the bigger and more obvious of the two. */}
      {items.length > 0 && (
        <div data-toast-obstacle="" className="mt-6 flex justify-end gap-3">
          {hasPending ? (
            <Button onClick={() => startUpload(assignment)}>{_('library.upload')}</Button>
          ) : isUploading ? (
            <Button variant="secondary" onClick={abortAll}>{_('library.uploadCancel')}</Button>
          ) : readable ? (
            <>
              <Button variant="secondary" onClick={handleClose}>{_('library.done')}</Button>
              <Button onClick={handleRead}>{_('library.startReading')}</Button>
            </>
          ) : failed > 0 ? (
            <>
              <Button variant="secondary" onClick={retryAll}>{_('library.uploadRetryAll')}</Button>
              <Button onClick={handleClose}>{_('library.done')}</Button>
            </>
          ) : (
            <Button onClick={handleClose}>{_('library.done')}</Button>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".epub,.txt"
        multiple
        className="hidden"
        onChange={(e) => {
          // Picker-selected files wait for an explicit upload click
          if (e.target.files?.length) {
            addFiles(e.target.files, {
              maxBytes,
              ...(versionNameMode && normalizeTitle ? { versionNameMode: true } : {}),
              ...assignment,
            })
          }
          e.target.value = ''
        }}
      />
    </Modal>
  )
}
