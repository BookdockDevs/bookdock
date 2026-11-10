import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { formatBytes } from '@/lib/utils'

import type { UploadItemView } from '../upload-types'

interface UploadFilesPanelProps {
  operation?: 'upload' | 'add'
  items: readonly UploadItemView[]
  maxBytes?: number
  dragOver: boolean
  setDragOver: (value: boolean) => void
  isUploading: boolean
  readable: boolean
  onChooseFiles: () => void
  onStartUpload: () => void
  retry: (id: string) => void
  retryAll: () => void
  continueUpload: (id: string) => void
  abortAll: () => void
  handleClose: () => void
  handleRead: () => void
  // Modal footers sit over the viewport bottom, so toasts must clear them. In a page-level
  // layout the action row scrolls with the document and lifting toasts above it looks broken.
  toastObstacle?: boolean
}

function statusLabel(item: UploadItemView): string | null {
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


function hasFiles(event: { dataTransfer: DataTransfer | null }): boolean {
  return Boolean(event.dataTransfer?.types.includes('Files'))
}

export default function UploadFilesPanel({ items, maxBytes, dragOver, setDragOver, isUploading, readable, onChooseFiles, onStartUpload, retry, retryAll, continueUpload, abortAll, handleClose, handleRead, toastObstacle = true, operation = 'upload' }: UploadFilesPanelProps) {
  const translate = useTranslation()
  const messages: Record<string, string> = {
    'library.upload': 'localLibrary.addAction',
    'library.uploadPending': 'localLibrary.addPending',
    'library.uploading': 'localLibrary.adding',
    'library.uploadFailed': 'localLibrary.addFailed',
    'library.uploadCancel': 'library.cancel',
  }
  const _ = (key: string, params?: Record<string, string | number>) => translate(operation === 'add' ? messages[key] ?? key : key, params)
  const hasPending = items.some((item) => item.status === 'pending')
  const failed = items.filter((item) => item.status === 'error').length
  // Retry is offered only where it can change the outcome; a row that cannot be
  // retried says why (its message already names the next step) and stops there.
  const failedRetryable = items.filter((item) => item.status === 'error' && item.retryable !== false).length
  return (<>
          <div
            onClick={onChooseFiles}
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
          'group flex h-80 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed text-center transition-all duration-150 ' +
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
        <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
          {items.map((item) => {
            const key = statusLabel(item)
            const note = item.messageKey ? _(item.messageKey) : item.message ?? null
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
                    {item.retryable !== false && (
                      <button
                        type="button"
                        onClick={() => retry(item.id)}
                        className="shrink-0 text-xs font-medium text-stone-600 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
                      >
                        {_('library.uploadRetry')}
                      </button>
                    )}
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
        <div data-upload-actions="" data-toast-obstacle={toastObstacle ? '' : undefined} className="mt-6 flex justify-end gap-3">
          {hasPending ? (
            <Button onClick={onStartUpload}>{_('library.upload')}</Button>
          ) : isUploading ? (
            <Button variant="secondary" onClick={abortAll}>{_('library.uploadCancel')}</Button>
          ) : readable ? (
            <>
              <Button variant="secondary" onClick={handleClose}>{_('library.done')}</Button>
              <Button onClick={handleRead}>{_('library.startReading')}</Button>
            </>
          ) : failed > 0 ? (
            <>
              {failedRetryable > 0 && <Button variant="secondary" onClick={retryAll}>{_('library.uploadRetryAll')}</Button>}
              <Button onClick={handleClose}>{_('library.done')}</Button>
            </>
          ) : (
            <Button onClick={handleClose}>{_('library.done')}</Button>
          )}
        </div>
      )}
  </>)
}
