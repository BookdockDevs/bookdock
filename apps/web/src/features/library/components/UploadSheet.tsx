import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'

import { useNavigate } from '@tanstack/react-router'

import { useAuthStore } from '@/stores/auth.store'
import { useStorageConnections } from '@/api/hooks/useStorageConnections'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useLocalCatalog } from '@/features/reading-data/catalog-source-context'
import { useWarmReaderEntry } from '@/features/reading-data/reader-entry-prefetch'
import { StorageConnectionDialog } from '@/features/settings/components/StorageConnectionsSection'
import StorageConnectionPicker from '@/features/settings/components/StorageConnectionPicker'

import { useShelves, useTags, useUploadBooks, useUploadSettings, type UploadAssignment, type UploadTarget } from '../hooks'
import UploadFilesPanel from './UploadFilesPanel'
import WebDavImportBrowser from './WebDavImportBrowser'

interface UploadSheetProps {
  open: boolean
  onClose: () => void
  libraryId?: string
  shelfId?: string
  categoryId?: string
  /**
   * Explicit taxonomy name in context. If omitted, looked up from shelfId.
   */
  shelfName?: string
  /** Whether the destination is a category or a shelf. */
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
  /** Destination the caller prefers when opening the file panel; falls back to server. */
  initialSource?: string
  /** Disables server upload (locks destination to local and hides external drive imports). */
  serverUploadDisabled?: boolean
}

function hasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return Boolean(e.dataTransfer?.types.includes('Files'))
}

const LAST_UPLOAD_SOURCE_KEY = 'bookdock:last_upload_source'

function getSavedUploadSource(): string {
  try {
    const saved = localStorage.getItem(LAST_UPLOAD_SOURCE_KEY)
    if (saved && saved !== 'server') return saved
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
  categoryId,
  shelfName: propShelfName,
  isCategory = false,
  tagId,
  target,
  versionNameMode = false,
  boundWork,
  contextNote,
  contextTitle,
  onUploaded,
  initialSource,
  serverUploadDisabled = false,
}: UploadSheetProps) {
  const _ = useTranslation()
  const local = useLocalCatalog()
  const warmReader = useWarmReaderEntry()
  const user = useAuthStore((state) => state.user)
  const { data: connectionsRes } = useStorageConnections({ enabled: !local && !serverUploadDisabled && Boolean(user) })
  const connections = useMemo(() => (local || serverUploadDisabled) ? [] : connectionsRes?.data ?? [], [local, serverUploadDisabled, connectionsRes?.data])
  const canSwitchDestination = !local && !target && !serverUploadDisabled
  const resolveInitialDestination = useCallback((): 'server' | 'local' => {
    if (local || serverUploadDisabled) return 'local'
    if (target) return 'server'
    return initialSource === 'local' ? 'local' : 'server'
  }, [local, serverUploadDisabled, target, initialSource])
  const [destination, setDestination] = useState<'server' | 'local'>(resolveInitialDestination)
  const resolvedDestination: 'server' | 'local' = local || serverUploadDisabled ? 'local' : target ? 'server' : destination
  const [selectedSource, setSelectedSource] = useState<string>(() => (local || serverUploadDisabled) ? 'local' : getSavedUploadSource())
  const [showAddConnection, setShowAddConnection] = useState(false)
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

  const selectedSourceRef = useRef(selectedSource)
  selectedSourceRef.current = selectedSource

  // A file drag opens the sheet via the global drag listener while the saved
  // source may still point at a remote drive. Flip the view back to file upload
  // as soon as files hover, so the sheet does not sit on the drive browser
  // waiting for the drop.
  // Intentionally visual-only: persisting happens on drop/success so cancelling
  // the drag keeps the saved preference.
  useEffect(() => {
    if (!open) return
    const onWindowDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files') && selectedSourceRef.current !== 'local') {
        setSelectedSource('local')
      }
    }
    window.addEventListener('dragover', onWindowDragOver)
    return () => window.removeEventListener('dragover', onWindowDragOver)
  }, [open])

  const shelfName = propShelfName ?? (shelfId ? shelvesData?.data.find((shelf) => shelf.id === shelfId)?.name : undefined)
  const contextTooltip = isCategory
    ? _('library.uploadCategoryContext', { name: shelfName ?? '' })
    : _('library.uploadShelfContext', { name: shelfName ?? '' })
  const tagName = tagId ? tagsData?.data.find((tag) => tag.id === tagId)?.name : undefined
  const assignment: UploadAssignment = {
    shelfId,
    categoryId,
    tagIds: includeCurrentTag && tagId ? [tagId] : [],
  }

  // clearQueue keeps in-flight items, so closing mid-upload stays resumable
  const handleClose = useCallback(() => {
    clearQueue()
    onClose()
  }, [clearQueue, onClose])

  useEffect(() => {
    if (!open) return
    setDestination(resolveInitialDestination())
  }, [open, resolveInitialDestination])

  useEffect(() => {
    if (!open) return
    if (local || serverUploadDisabled) { setSelectedSource('local'); return }
    const saved = getSavedUploadSource()
    if (saved === 'local') { setSelectedSource('local'); return }
    // Wait for the connection list before judging the remembered id: an empty
    // list during the first fetch must not look like "the drive is gone".
    if (connectionsRes !== undefined) {
      setSelectedSource(connections.some((c) => c.id === saved) ? saved : 'local')
    }
  }, [open, connections, connectionsRes, local, serverUploadDisabled])

  useEffect(() => {
    if (selectedSource !== 'local' && connections.length > 0 && !connections.some((c) => c.id === selectedSource)) {
      setSelectedSource('local')
    }
  }, [selectedSource, connections])

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
        destination: resolvedDestination,
        maxBytes: resolvedDestination === 'local' ? undefined : maxBytes,
        ...(versionNameMode && normalizeTitle ? { versionNameMode: true } : {}),
        ...assignment,
      })
    }
  }

  const hasPending = items.some((it) => it.status === 'pending')
  const settled = items.length > 0 && !isUploading && !hasPending

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
    && Boolean(items[0].bookVersionId || items[0].bookRef)
    && !(boundWork ?? versionNameMode)

  function handleRead() {
    const localRef = items[0]?.bookRef
    const bookVersionId = items[0]?.bookVersionId
    if (!bookVersionId && !localRef) return
    const targetBookId = localRef ? localRef.bookId : bookVersionId!
    warmReader({ bookId: targetBookId, isLocal: Boolean(localRef) })
    clearQueue()
    onClose()
    void navigate({ to: '/books/$id', params: { id: targetBookId } })
  }

  if (!open) return null

  const showDestinationSwitch = canSwitchDestination && selectedSource === 'local'
  const sheetTitle = _(canSwitchDestination || local || serverUploadDisabled ? 'localLibrary.add' : 'library.upload')

  return (
    <Modal
      size="wide"
      title={(
        <div className="flex flex-wrap items-center gap-2">
          <span className={showDestinationSwitch ? 'sr-only' : undefined}>{sheetTitle}</span>
          {showDestinationSwitch && (
            <div
              role="group"
              aria-label={_('library.addDestination')}
              className="inline-flex items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 font-normal dark:bg-stone-800"
            >
              <button
                type="button"
                disabled={isUploading}
                aria-pressed={resolvedDestination === 'server'}
                onClick={() => setDestination('server')}
                className={cn(
                  'flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50',
                  resolvedDestination === 'server'
                    ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
                )}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 13v8" />
                  <path d="m8 17 4-4 4 4" />
                  <path d="M20 16.6A4.5 4.5 0 0 0 18 8h-1.3A7 7 0 1 0 5 14.4" />
                </svg>
                <span>{_('library.sourceRemote')}</span>
              </button>
              <button
                type="button"
                disabled={isUploading}
                aria-pressed={resolvedDestination === 'local'}
                onClick={() => setDestination('local')}
                className={cn(
                  'flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50',
                  resolvedDestination === 'local'
                    ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
                )}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect width="20" height="14" x="2" y="3" rx="2" />
                  <line x1="8" x2="16" y1="21" y2="21" />
                  <line x1="12" x2="12" y1="17" y2="21" />
                </svg>
                <span>{_('library.sourceLocal')}</span>
              </button>
            </div>
          )}
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
      actions={!local && !serverUploadDisabled && (
        <div className="relative flex items-center mr-1">
          <StorageConnectionPicker
            connections={connections}
            value={selectedSource}
            onChange={handleSelectSource}
            showLocalOption
            localLabel={_('library.uploadLocal') || '本地文件'}
            onAddNew={() => setShowAddConnection(true)}
            addNewLabel={_('settings.storageBackendConnectionAddNew') || '添加存储'}
            triggerClassName="border-stone-200/90 bg-stone-50/80 shadow-2xs hover:bg-stone-100 dark:bg-stone-800/80 dark:hover:bg-stone-700"
          />
          {showAddConnection && (
            <StorageConnectionDialog
              mode="add"
              onClose={() => setShowAddConnection(false)}
              onSuccess={(conn) => {
                handleSelectSource(conn.id)
                setShowAddConnection(false)
              }}
            />
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
          categoryId={categoryId}
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
          <UploadFilesPanel
            // The destination decides the wording: a local-bound queue adds to
            // the device vault even on the unified shelf without a context.
            operation={resolvedDestination === 'local' ? 'add' : 'upload'}
            items={items}
            maxBytes={resolvedDestination === 'local' ? undefined : maxBytes}
            dragOver={dragOver}
            setDragOver={setDragOver}
            isUploading={isUploading}
            readable={readable}
            onChooseFiles={() => inputRef.current?.click()}
            onStartUpload={() => startUpload(assignment, resolvedDestination)}
            retry={retry}
            retryAll={retryAll}
            continueUpload={continueUpload}
            abortAll={abortAll}
            handleClose={handleClose}
            handleRead={handleRead}
          />
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
              destination: resolvedDestination,
              maxBytes: resolvedDestination === 'local' ? undefined : maxBytes,
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
