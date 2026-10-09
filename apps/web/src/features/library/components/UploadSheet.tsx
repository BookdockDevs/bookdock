import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'

import { useNavigate } from '@tanstack/react-router'

import { useStorageConnections } from '@/api/hooks/useStorageConnections'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import type { SmartPosition } from '@/lib/position'
import { cn, formatBytes } from '@/lib/utils'

import { useShelves, useTags, useUploadBooks, useUploadSettings, type UploadAssignment, type UploadItem, type UploadTarget } from '../hooks'
import { useContextMenu } from './use-context-menu'
import WebDavImportBrowser from './WebDavImportBrowser'

interface UploadSheetProps {
  open: boolean
  onClose: () => void
  libraryId?: string
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

const LAST_UPLOAD_SOURCE_KEY = 'bookdock:last_upload_source'

function getSavedUploadSource(): string {
  try {
    const saved = localStorage.getItem(LAST_UPLOAD_SOURCE_KEY)
    if (saved) return saved
  } catch {
    // ignore
  }
  return 'local'
}

export default function UploadSheet({
  open,
  onClose,
  libraryId,
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
  const { data: connectionsRes } = useStorageConnections()
  const connections = useMemo(() => connectionsRes?.data ?? [], [connectionsRes?.data])
  const [selectedSource, setSelectedSource] = useState<string>(() => getSavedUploadSource())
  const sourceMenu = useContextMenu()
  const [dragOver, setDragOver] = useState(false)
  const [includeCurrentTag, setIncludeCurrentTag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { items, addFiles, startUpload, retry, retryAll, continueUpload, abortAll, pruneSettled, isUploading, clearQueue } = useUploadBooks(target)
  const reportedRef = useRef('')
  const { maxBytes, normalizeTitle } = useUploadSettings()
  const { data: shelvesData } = useShelves()
  const { data: tagsData } = useTags()

  const handleSelectSource = useCallback((source: string) => {
    setSelectedSource(source)
    try {
      localStorage.setItem(LAST_UPLOAD_SOURCE_KEY, source)
    } catch {
      // ignore
    }
  }, [])

  const currentSourceName = useMemo(() => {
    if (selectedSource === 'local') {
      return _('library.uploadSourceLocal') || '本地文件'
    }
    const conn = connections.find((c) => c.id === selectedSource)
    return conn?.name || (_('library.uploadSourceLocal') || '本地文件')
  }, [selectedSource, connections, _])

  const sourceAnchor = sourceMenu.btnRef.current?.getBoundingClientRect()
  const sourceMenuWidth = Math.max(160, Math.min(240, (sourceAnchor?.width ?? 120) + 40))
  const sourceMenuPosition = useMemo((): SmartPosition | null => {
    if (!sourceMenu.open || !sourceAnchor) return null
    return {
      left: Math.max(8, Math.min(sourceAnchor.right - sourceMenuWidth, window.innerWidth - sourceMenuWidth - 8)),
      top: sourceAnchor.bottom + 6,
      dir: 'down',
    }
  }, [sourceMenu.open, sourceAnchor, sourceMenuWidth])

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
    if (open) {
      const saved = getSavedUploadSource()
      if (saved === 'local') {
        setSelectedSource('local')
      } else if (connections.length > 0) {
        if (connections.some((c) => c.id === saved)) {
          setSelectedSource(saved)
        } else {
          setSelectedSource('local')
        }
      }
    }
  }, [open, connections])

  useEffect(() => {
    if (selectedSource !== 'local' && connections.length > 0 && !connections.some((c) => c.id === selectedSource)) {
      setSelectedSource('local')
    }
  }, [selectedSource, connections])

  useEffect(() => {
    if (items.some((i) => i.status === 'success')) {
      try {
        localStorage.setItem(LAST_UPLOAD_SOURCE_KEY, 'local')
      } catch {
        // ignore
      }
    }
  }, [items])

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
    if (selectedSource !== 'local') handleSelectSource('local')
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
      size="wide"
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
      actions={(
        <div className="relative flex items-center mr-1">
          <button
            ref={sourceMenu.btnRef}
            type="button"
            onClick={sourceMenu.toggleFromButton}
            aria-haspopup="listbox"
            aria-expanded={sourceMenu.open}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border border-stone-200/90 bg-stone-50/80 px-2.5 py-1 text-xs font-medium text-stone-700 shadow-2xs transition-colors hover:border-stone-300 hover:bg-stone-100 focus:outline-none dark:border-stone-700/80 dark:bg-stone-800/80 dark:text-stone-300 dark:hover:bg-stone-750',
              sourceMenu.open && 'border-stone-400 dark:border-stone-500',
            )}
          >
            {selectedSource === 'local' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-400">
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-400">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              </svg>
            )}
            <span className="max-w-[140px] truncate">{currentSourceName}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn('shrink-0 text-stone-400 transition-transform dark:text-stone-500', sourceMenu.open && 'rotate-180')}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {sourceMenu.open && (
            <SmartMenu
              triggerRef={sourceMenu.btnRef}
              innerRef={sourceMenu.menuRef}
              position={sourceMenuPosition}
              onClose={sourceMenu.close}
              width={sourceMenuWidth}
            >
              <div className="max-h-60 overflow-y-auto overscroll-contain py-1">
                <button
                  type="button"
                  onClick={() => {
                    handleSelectSource('local')
                    sourceMenu.close()
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer',
                    selectedSource === 'local'
                      ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                      : 'text-stone-600 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100',
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                      <rect width="20" height="14" x="2" y="3" rx="2" />
                      <line x1="8" x2="16" y1="21" y2="21" />
                      <line x1="12" x2="12" y1="17" y2="21" />
                    </svg>
                    <span className="truncate">{_('library.uploadSourceLocal') || '本地文件'}</span>
                  </div>
                  {selectedSource === 'local' && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-600 dark:text-stone-300">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>

                {connections.length > 0 && <div className="my-1 border-t border-stone-200/80 dark:border-stone-800" />}

                {connections.map((conn) => {
                  const isSelected = selectedSource === conn.id
                  return (
                    <button
                      key={conn.id}
                      type="button"
                      onClick={() => {
                        handleSelectSource(conn.id)
                        sourceMenu.close()
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer',
                        isSelected
                          ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                          : 'text-stone-600 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100',
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                        </svg>
                        <span className="truncate">{conn.name}</span>
                      </div>
                      {isSelected && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-600 dark:text-stone-300">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  )
                })}

                <div className="my-1 border-t border-stone-200/80 dark:border-stone-800" />

                <button
                  type="button"
                  onClick={() => {
                    sourceMenu.close()
                    handleClose()
                    void navigate({ to: '/settings', search: { section: 'integrations' } })
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-stone-500 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100 cursor-pointer"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>{_('library.uploadSourceManage') || '管理存储源...'}</span>
                </button>
              </div>
            </SmartMenu>
          )}
        </div>
      )}
      onClose={handleClose}
      // The default reads "cancel", which now collides with the footer's
      // cancel-upload: here closing the window is not cancelling anything.
      closeLabel={_('library.close')}
      containerProps={{
        onDragOver: (e) => {
          if (hasFiles(e)) e.preventDefault()
        },
        onDrop: acceptDrop,
      }}
    >

      {selectedSource !== 'local' ? (
        <WebDavImportBrowser
          connectionId={selectedSource}
          onConnectionChange={handleSelectSource}
          libraryId={libraryId}
          shelfId={shelfId}
          tagId={tagId}
          includeCurrentTag={includeCurrentTag}
          target={target}
          onClose={handleClose}
          onImportComplete={(ids) => {
            try {
              localStorage.setItem(LAST_UPLOAD_SOURCE_KEY, selectedSource)
            } catch {
              // ignore
            }
            onUploaded?.(ids)
          }}
        />
      ) : (
        <>
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
        </>
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
