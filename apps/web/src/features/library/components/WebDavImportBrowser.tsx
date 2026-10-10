import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import {
  useStorageConnectionImport,
  useStorageConnectionLs,
  useStorageConnections,
} from '@/api/hooks/useStorageConnections'
import { Button } from '@/components/ui/Button'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { cn, formatBytes } from '@/lib/utils'
import { notify } from '@/lib/notifications'
import { useContextMenu } from './use-context-menu'
import type { UploadTarget } from '../hooks'
import type { WebDavEntry } from '@bookdock/shared'

interface WebDavImportBrowserProps {
  connectionId?: string
  onConnectionChange?: (id: string) => void
  libraryId?: string
  shelfId?: string
  tagId?: string
  includeCurrentTag?: boolean
  target?: UploadTarget
  onClose?: () => void
  onImportComplete?: (ids: string[]) => void
}

const WEBDAV_CACHE_KEY = 'bookdock:webdav_browser_cache'

interface CachedWebDavBrowserState {
  lastConnectionId?: string
  paths: Record<string, string>
}

interface ImportTaskItem {
  id: string
  path: string
  name: string
  status: 'queued' | 'downloading' | 'processing' | 'success' | 'duplicate' | 'error'
  progress: number
  errorMessage?: string
  bookVersionId?: string
}

function getCachedBrowserState(): CachedWebDavBrowserState {
  try {
    const raw = sessionStorage.getItem(WEBDAV_CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CachedWebDavBrowserState>
      return {
        lastConnectionId: typeof parsed.lastConnectionId === 'string' ? parsed.lastConnectionId : undefined,
        paths: typeof parsed.paths === 'object' && parsed.paths !== null ? parsed.paths : {},
      }
    }
  } catch {
    // ignore
  }
  return { paths: {} }
}

function setCachedBrowserState(connectionId: string, path: string) {
  try {
    const current = getCachedBrowserState()
    current.lastConnectionId = connectionId
    current.paths[connectionId] = path
    sessionStorage.setItem(WEBDAV_CACHE_KEY, JSON.stringify(current))
  } catch {
    // ignore
  }
}

export default function WebDavImportBrowser({
  connectionId: propConnectionId,
  onConnectionChange,
  libraryId: propLibraryId,
  shelfId,
  tagId,
  includeCurrentTag,
  target,
  onClose,
  onImportComplete,
}: WebDavImportBrowserProps) {
  const _ = useTranslation()
  const navigate = useNavigate()

  const { data: connectionsRes, isLoading: isConnectionsLoading } = useStorageConnections()
  const connections = useMemo(() => connectionsRes?.data ?? [], [connectionsRes?.data])
  const hasConnections = connections.length > 0

  const initialCache = useMemo(() => getCachedBrowserState(), [])
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(
    propConnectionId || initialCache.lastConnectionId || '',
  )
  const isControlled = Boolean(propConnectionId)
  const activeConnectionId = propConnectionId || selectedConnectionId

  const [currentPath, setCurrentPath] = useState<string>(() => {
    const targetId = propConnectionId || initialCache.lastConnectionId
    if (targetId && initialCache.paths[targetId]) {
      return initialCache.paths[targetId]
    }
    return '/'
  })
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const driveMenu = useContextMenu()

  useEffect(() => {
    if (propConnectionId) {
      setSelectedConnectionId(propConnectionId)
      const cached = getCachedBrowserState()
      const targetConn = connections.find((c) => c.id === propConnectionId)
      const savedPath = cached.paths[propConnectionId] || targetConn?.basePath || '/'
      setCurrentPath(savedPath)
      setSelectedPaths(new Set())
    } else if (connections.length > 0) {
      const cached = getCachedBrowserState()
      const cachedConn = cached.lastConnectionId ? connections.find((c) => c.id === cached.lastConnectionId) : undefined
      const currentSelectedConn = selectedConnectionId ? connections.find((c) => c.id === selectedConnectionId) : undefined
      const defaultConn = connections[0]
      const targetConn = currentSelectedConn || cachedConn || defaultConn

      if (!selectedConnectionId || targetConn.id !== selectedConnectionId) {
        setSelectedConnectionId(targetConn.id)
        const savedPath = cached.paths[targetConn.id] || targetConn.basePath || '/'
        setCurrentPath(savedPath)
        setSelectedPaths(new Set())
      }
    }
  }, [connections, propConnectionId, selectedConnectionId])

  useEffect(() => {
    if (activeConnectionId && currentPath) {
      setCachedBrowserState(activeConnectionId, currentPath)
    }
  }, [activeConnectionId, currentPath])

  const { data: lsRes, isLoading: isListing, isError, error: lsError, refetch } = useStorageConnectionLs(
    activeConnectionId || null,
    currentPath,
    {
      enabled: Boolean(activeConnectionId),
    },
  )
  const importMutation = useStorageConnectionImport(activeConnectionId || null)

  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [queueItems, setQueueItems] = useState<ImportTaskItem[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const abortRef = useRef(false)
  const pendingPathsRef = useRef<string[]>([])
  const isProcessingRef = useRef(false)

  useEffect(() => {
    return () => {
      abortRef.current = true
    }
  }, [])

  const hasSettledItems = useMemo(
    () =>
      queueItems.length > 0 &&
      !isImporting &&
      queueItems.every((item) => item.status === 'success' || item.status === 'duplicate' || item.status === 'error'),
    [queueItems, isImporting],
  )
  const failedCount = useMemo(
    () => queueItems.filter((item) => item.status === 'error').length,
    [queueItems],
  )
  const readable = useMemo(
    () =>
      hasSettledItems &&
      queueItems.length === 1 &&
      (queueItems[0].status === 'success' || queueItems[0].status === 'duplicate') &&
      Boolean(queueItems[0].bookVersionId),
    [hasSettledItems, queueItems],
  )

  const entries: WebDavEntry[] = useMemo(() => {
    const raw = lsRes?.data ?? []
    return raw.filter((e) => e.type === 'dir' || e.isSupported)
  }, [lsRes?.data])
  const trimmedSearch = searchQuery.trim().toLowerCase()
  const displayEntries = useMemo(() => {
    if (!trimmedSearch) return entries
    return entries.filter((e) => e.name.toLowerCase().includes(trimmedSearch))
  }, [entries, trimmedSearch])

  const supportedFiles = displayEntries.filter((e) => e.type === 'file' && e.isSupported)

  const allSupportedSelected =
    supportedFiles.length > 0 && supportedFiles.every((f) => selectedPaths.has(f.path))

  function handleConnectionChange(id: string) {
    if (id === activeConnectionId) return
    setSelectedConnectionId(id)
    onConnectionChange?.(id)
    const conn = connections.find((c) => c.id === id)
    const cached = getCachedBrowserState()
    const targetPath = cached.paths[id] || conn?.basePath || '/'
    setCurrentPath(targetPath)
    setSelectedPaths(new Set())
    setQueueItems([])
    setIsImporting(false)
    setSearchQuery('')
    setIsSearchOpen(false)
    setCachedBrowserState(id, targetPath)
  }

  function toggleFile(path: string) {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (allSupportedSelected) {
        for (const file of supportedFiles) {
          next.delete(file.path)
        }
      } else {
        for (const file of supportedFiles) {
          next.add(file.path)
        }
      }
      return next
    })
  }

  const handleGoUp = useCallback(() => {
    if (currentPath === '/' || !currentPath) return
    const segments = currentPath.split('/').filter(Boolean)
    segments.pop()
    setCurrentPath(segments.length ? `/${segments.join('/')}` : '/')
    setSearchQuery('')
  }, [currentPath])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Backspace' && currentPath !== '/') {
        e.preventDefault()
        handleGoUp()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPath, handleGoUp])

  const patchQueueItem = useCallback((id: string, patch: Partial<ImportTaskItem>) => {
    setQueueItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const runQueue = useCallback(async () => {
    if (isProcessingRef.current || !activeConnectionId) return
    isProcessingRef.current = true
    setIsImporting(true)
    abortRef.current = false

    const targetLibraryId = propLibraryId ?? (target?.url ? target.url.match(/\/libraries\/([^/]+)/)?.[1] : undefined)
    const newlyCreatedIds: string[] = []
    let freshSuccessCount = 0
    let freshDuplicateCount = 0
    let freshErrorCount = 0

    while (pendingPathsRef.current.length > 0 && !abortRef.current) {
      const nextPath = pendingPathsRef.current.shift()!

      patchQueueItem(nextPath, { status: 'downloading', progress: 20 })

      let currentPct = 20
      const progressTimer = setInterval(() => {
        if (currentPct < 75) {
          currentPct += 15
          patchQueueItem(nextPath, { status: 'downloading', progress: currentPct })
        } else if (currentPct < 90) {
          currentPct += 5
          patchQueueItem(nextPath, { status: 'processing', progress: currentPct })
        }
      }, 300)

      try {
        const res = await importMutation.mutateAsync({
          files: [nextPath],
          shelfId,
          tagIds: includeCurrentTag && tagId ? [tagId] : undefined,
          libraryId: targetLibraryId,
        })
        clearInterval(progressTimer)

        const resItem = res.data.results[0]
        if (resItem?.status === 'success') {
          freshSuccessCount++
          const bookVersionId = resItem.bookId
          if (bookVersionId) newlyCreatedIds.push(bookVersionId)
          patchQueueItem(nextPath, { status: 'success', progress: 100, bookVersionId })
        } else if (resItem?.status === 'duplicate') {
          freshDuplicateCount++
          patchQueueItem(nextPath, { status: 'duplicate', progress: 100 })
        } else {
          freshErrorCount++
          patchQueueItem(nextPath, {
            status: 'error',
            progress: 100,
            errorMessage: resItem?.errorMessage || '导入失败',
          })
        }
      } catch (err) {
        clearInterval(progressTimer)
        freshErrorCount++
        const msg = err instanceof Error ? err.message : String(err)
        patchQueueItem(nextPath, {
          status: 'error',
          progress: 100,
          errorMessage: msg,
        })
      }
    }

    isProcessingRef.current = false
    setIsImporting(false)

    if (newlyCreatedIds.length > 0) {
      onImportComplete?.(newlyCreatedIds)
    }

    if (freshSuccessCount > 0) {
      const summaryMsg =
        _('library.webdavImportSummary', {
          success: freshSuccessCount,
          duplicate: freshDuplicateCount,
          error: freshErrorCount,
        }) ||
        `成功导入 ${freshSuccessCount} 本${freshDuplicateCount > 0 ? `，重复 ${freshDuplicateCount} 本` : ''}${
          freshErrorCount > 0 ? `，失败 ${freshErrorCount} 本` : ''
        }`
      notify.success(summaryMsg, {
        title: _('library.webdavImportSuccess') || '导入完成',
      })
    } else if (freshDuplicateCount > 0 && freshErrorCount === 0) {
      notify.info(`选中的 ${freshDuplicateCount} 本图书已在书库中`, {
        title: _('library.webdavImportDuplicate') || '书籍已存在',
      })
    } else if (freshErrorCount > 0) {
      notify.error(`有 ${freshErrorCount} 本图书导入失败，可点击重试`, {
        title: _('library.webdavImportFailed') || '导入失败',
      })
    }
  }, [activeConnectionId, importMutation, includeCurrentTag, onImportComplete, patchQueueItem, propLibraryId, shelfId, tagId, target, _])

  const startImportQueue = useCallback(
    (pathsToImport: string[]) => {
      if (pathsToImport.length === 0 || !activeConnectionId) return

      const newItems: ImportTaskItem[] = pathsToImport.map((p) => ({
        id: p,
        path: p,
        name: p.split('/').filter(Boolean).pop() || 'book',
        status: 'queued',
        progress: 0,
      }))

      setSelectedPaths((prev) => {
        const next = new Set(prev)
        for (const p of pathsToImport) next.delete(p)
        return next
      })

      setQueueItems((prev) => {
        const existingIds = new Set(newItems.map((n) => n.id))
        const retained = prev.filter((it) => !existingIds.has(it.id))
        return [...retained, ...newItems]
      })

      for (const p of pathsToImport) {
        if (!pendingPathsRef.current.includes(p)) {
          pendingPathsRef.current.push(p)
        }
      }

      setTimeout(() => {
        void runQueue()
      }, 0)
    },
    [activeConnectionId, runQueue],
  )

  function handleRetryOne(path: string) {
    startImportQueue([path])
  }

  function handleRetryAllFailed() {
    const failedPaths = queueItems.filter((i) => i.status === 'error').map((i) => i.path)
    if (failedPaths.length > 0) {
      startImportQueue(failedPaths)
    }
  }

  function handleAbort() {
    abortRef.current = true
    pendingPathsRef.current = []
    isProcessingRef.current = false
    setIsImporting(false)
  }

  function handleRead() {
    const bookVersionId = queueItems[0]?.bookVersionId
    if (!bookVersionId) return
    onClose?.()
    void navigate({ to: '/books/$id', params: { id: bookVersionId } })
  }

  if (isConnectionsLoading) {
    return (
      <div className="flex h-72 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600 dark:border-stone-700 dark:border-t-stone-300" />
      </div>
    )
  }

  if (!hasConnections) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-stone-300 p-6 text-center dark:border-stone-700">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
            {_('library.webdavNotConfiguredTitle') || '未配置外部存储'}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            {_('library.webdavNotConfiguredDesc') || '在设置中连接外部存储（如 WebDAV）后，即可直接浏览并批量导入 EPUB、TXT 图书。'}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            onClose?.()
            void navigate({ to: '/settings', search: { section: 'integrations' } })
          }}
        >
          {_('library.webdavGoToSettings') || '前往设置连接'}
        </Button>
      </div>
    )
  }

  const breadcrumbs = currentPath.split('/').filter(Boolean)
  const selectedConnection = connections.find((c) => c.id === activeConnectionId) || connections[0]
  const driveAnchor = driveMenu.btnRef.current?.getBoundingClientRect()
  const driveMenuWidth = Math.max(160, Math.min(260, driveAnchor?.width ?? 180))
  const driveMenuHeight = Math.min(192, connections.length * 34 + 8)
  const driveMenuPosition = driveMenu.position(driveMenuWidth, driveMenuHeight)

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
      {/* Integrated Header Toolbar */}
      <div className="border-b border-stone-200 bg-stone-50/80 dark:border-stone-800 dark:bg-stone-900/90">
        {!isControlled && (
          /* Drive Selector Bar */
          <div className="flex items-center justify-between border-b border-stone-200/60 px-3.5 py-2 text-xs dark:border-stone-800/80">
            <div className="relative flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-stone-200/60 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                </svg>
              </span>
              <label htmlFor="drive-select" className="sr-only">
                {_('library.storageConnectionSelectLabel') || '选择存储'}
              </label>
              {/* Native select kept visually hidden for accessibility and automated testing */}
              <select
                id="drive-select"
                value={activeConnectionId}
                onChange={(e) => handleConnectionChange(e.target.value)}
                className="sr-only"
                tabIndex={-1}
              >
                {connections.map((conn) => (
                  <option key={conn.id} value={conn.id}>
                    {conn.name}
                  </option>
                ))}
              </select>

              <button
                ref={driveMenu.btnRef}
                type="button"
                onClick={driveMenu.toggleFromButton}
                aria-haspopup="listbox"
                aria-expanded={driveMenu.open}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-800 shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700/60',
                  driveMenu.open && 'border-stone-400 dark:border-stone-500',
                )}
              >
                <span className="max-w-[180px] truncate">{selectedConnection?.name}</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cn('shrink-0 text-stone-400 transition-transform dark:text-stone-500', driveMenu.open && 'rotate-180')}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {driveMenu.open && (
                <SmartMenu
                  triggerRef={driveMenu.btnRef}
                  innerRef={driveMenu.menuRef}
                  position={driveMenuPosition}
                  onClose={driveMenu.close}
                  width={driveMenuWidth}
                >
                  <div className="max-h-48 overflow-y-auto overscroll-contain">
                    {connections.map((conn) => {
                      const isSelected = conn.id === activeConnectionId
                      return (
                        <button
                          key={conn.id}
                          type="button"
                          onClick={() => {
                            handleConnectionChange(conn.id)
                            driveMenu.close()
                          }}
                          className={cn(
                            'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer',
                            isSelected
                              ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                              : 'text-stone-600 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100',
                          )}
                        >
                          <span className="truncate">{conn.name}</span>
                          {isSelected && (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-600 dark:text-stone-300">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </SmartMenu>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                onClose?.()
                void navigate({ to: '/settings', search: { section: 'integrations' } })
              }}
              title={_('library.storageConnectionManage') || '管理存储'}
              aria-label={_('library.storageConnectionManage') || '管理存储'}
              className="inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        )}

        {/* Path Navigation & Quick Action Bar */}
        <div className="flex items-center justify-between bg-stone-100/40 px-3 py-1.5 text-xs dark:bg-stone-900/60">
          <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto text-stone-600 dark:text-stone-300">
            <button
              type="button"
              onClick={() => setCurrentPath('/')}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium text-stone-600 transition-colors hover:bg-stone-200/50 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400 dark:text-stone-500">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <span>{_('library.webdavRoot') || '根目录'}</span>
            </button>
            {breadcrumbs.map((segment, idx) => {
              const target = '/' + breadcrumbs.slice(0, idx + 1).join('/')
              const isLast = idx === breadcrumbs.length - 1
              return (
                <span key={target} className="flex shrink-0 items-center gap-1">
                  <span className="text-stone-300 dark:text-stone-600">/</span>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentPath(target)
                      setSearchQuery('')
                    }}
                    className={cn(
                      'max-w-[120px] truncate rounded px-1.5 py-0.5 text-stone-600 transition-colors hover:bg-stone-200/50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100',
                      isLast && 'font-medium text-stone-900 dark:text-stone-100',
                    )}
                    title={segment}
                  >
                    {segment}
                  </button>
                </span>
              )
            })}
          </div>

          <div className="flex shrink-0 items-center gap-1 pl-2">
            {isSearchOpen ? (
              <div className="relative flex items-center">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      if (searchQuery) setSearchQuery('')
                      else setIsSearchOpen(false)
                    }
                  }}
                  placeholder={_('library.webdavSearchPlaceholder') || '搜索当前目录...'}
                  className="h-6.5 w-32 rounded-md border border-stone-200 bg-white px-2 pr-6 text-xs text-stone-800 placeholder-stone-400 shadow-2xs transition-all focus:w-44 focus:border-stone-400 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder-stone-500"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    if (searchQuery) setSearchQuery('')
                    else setIsSearchOpen(false)
                  }}
                  title={searchQuery ? (_('library.webdavClearSearch') || '清除搜索') : '关闭搜索'}
                  aria-label={searchQuery ? (_('library.webdavClearSearch') || '清除搜索') : '关闭搜索'}
                  className="absolute right-1.5 p-0.5 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 cursor-pointer"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(true)
                  setTimeout(() => searchInputRef.current?.focus(), 50)
                }}
                title={_('library.webdavSearch') || '搜索当前目录'}
                aria-label={_('library.webdavSearch') || '搜索当前目录'}
                className="rounded-md p-1.5 text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            )}
            {currentPath !== '/' && (
              <button
                type="button"
                onClick={handleGoUp}
                title={_('library.webdavUp') || '返回上一级'}
                aria-label={_('library.webdavUp') || '返回上一级'}
                className="rounded-md p-1.5 text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12 7-7 7 7" />
                  <path d="M12 19V5" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => void refetch()}
              title={_('library.webdavRefresh') || '刷新'}
              aria-label={_('library.webdavRefresh') || '刷新'}
              className="rounded-md p-1.5 text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* File List Area */}
      <div className="h-64 overflow-y-auto bg-white p-1.5 text-xs dark:bg-stone-900">
        {isListing ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600 dark:border-stone-700 dark:border-t-stone-300" />
          </div>
        ) : isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-stone-500 dark:text-stone-400">
            <p>{_('library.webdavListFailed') || '无法获取目录内容'}</p>
            {lsError instanceof Error && lsError.message && (
              <p className="max-w-md px-4 text-center text-[11px] text-stone-400 dark:text-stone-500">
                {lsError.message}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => void refetch()}>
                {_('library.retry') || '重试'}
              </Button>
              {currentPath !== '/' && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setCurrentPath('/'); setSearchQuery('') }}>
                  {_('library.webdavBackToRoot') || '返回根目录'}
                </Button>
              )}
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-stone-400 dark:text-stone-500">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <p>{_('library.webdavEmptyDir') || '此目录下没有文件'}</p>
          </div>
        ) : displayEntries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-stone-400 dark:text-stone-500">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p>{_('library.webdavNoSearchResults') || '未找到匹配的文件'}</p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {displayEntries.map((entry) => {
              if (entry.type === 'dir') {
                return (
                  <li key={entry.path}>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentPath(entry.path)
                        setSearchQuery('')
                      }}
                      className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-stone-100/80 dark:hover:bg-stone-800/80 cursor-pointer"
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-amber-500/90 transition-transform group-hover:scale-105">
                        <path d="M20 5h-8.586L9.707 3.293A1 1 0 0 0 9 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />
                      </svg>
                      <span className="flex-1 truncate font-medium text-stone-800 dark:text-stone-200">
                        {entry.name}
                      </span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </button>
                  </li>
                )
              }

              const ext = entry.name.split('.').pop()?.toUpperCase() || ''
              const isChecked = selectedPaths.has(entry.path)

              return (
                <li key={entry.path}>
                  <label
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-stone-100/80 dark:hover:bg-stone-800/80"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleFile(entry.path)}
                      className="h-4 w-4 rounded border-stone-300 text-stone-800 focus:ring-stone-500 dark:border-stone-700 dark:bg-stone-800"
                    />
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-600 dark:text-stone-300">
                      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                      <path d="M6 6h10" />
                      <path d="M6 10h10" />
                    </svg>
                    <span className="flex-1 truncate text-stone-700 dark:text-stone-300">
                      {entry.name}
                    </span>
                    <span className="shrink-0 rounded bg-stone-100 px-1 py-0.5 font-mono text-[10px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                      {ext}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-stone-400">
                      {entry.size ? formatBytes(entry.size) : ''}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Task Queue Area directly beneath file list when queueItems > 0 */}
      {queueItems.length > 0 && (
        <div className="border-t border-stone-200/80 dark:border-stone-800">
          <ul data-toast-obstacle="" className="max-h-44 space-y-2 overflow-y-auto p-2.5 text-xs">
            {queueItems.map((item) => (
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
                  ) : (
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700 dark:border-stone-600 dark:border-t-stone-200" />
                  )}
                </span>

                <span className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-300">
                  {item.name}
                </span>

                {item.status === 'error' ? (
                  <>
                    <span className="max-w-[140px] truncate shrink-0 text-xs text-red-600 dark:text-red-400" title={item.errorMessage}>
                      {item.errorMessage || _('library.uploadFailed') || '导入失败'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRetryOne(item.path)}
                      disabled={isImporting}
                      className="shrink-0 text-xs font-medium text-stone-600 underline decoration-stone-300 underline-offset-2 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100 disabled:opacity-40 cursor-pointer"
                    >
                      {_('library.uploadRetry') || '重试'}
                    </button>
                  </>
                ) : item.status === 'success' ? (
                  <span className="shrink-0 text-xs text-stone-400">
                    {_('library.uploadDone') || '完成'}
                  </span>
                ) : item.status === 'duplicate' ? (
                  <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                    {_('library.uploadDuplicate') || '已存在'}
                  </span>
                ) : item.status === 'downloading' ? (
                  <span className="shrink-0 text-xs text-stone-400">
                    拉取中
                  </span>
                ) : item.status === 'processing' ? (
                  <span className="shrink-0 text-xs text-stone-400">
                    {_('library.processing') || '处理中...'}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-stone-400">
                    {_('library.uploadQueued') || '排队中'}
                  </span>
                )}

                {(item.status === 'downloading' || item.status === 'processing') && (
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
            ))}
          </ul>
        </div>
      )}

      {/* Action Footer */}
      <div className="flex items-center justify-between border-t border-stone-200 bg-stone-50/80 px-3.5 py-2.5 text-xs dark:border-stone-800 dark:bg-stone-900/90">
        <div>
          {supportedFiles.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 select-none text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200">
              <input
                type="checkbox"
                checked={allSupportedSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-stone-300 text-stone-800 focus:ring-stone-500 dark:border-stone-700 dark:bg-stone-800"
              />
              <span>{_('library.webdavSelectAll') || '全选'}</span>
            </label>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectedPaths.size > 0 ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => startImportQueue(Array.from(selectedPaths))}
            >
              {`${_('library.webdavStartImport') || '开始导入'} (${selectedPaths.size})`}
            </Button>
          ) : isImporting ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleAbort}
            >
              {_('library.uploadCancel') || '取消'}
            </Button>
          ) : readable ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onClose?.()}
              >
                {_('library.done') || '完成'}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleRead}
              >
                {_('library.startReading') || '开始阅读'}
              </Button>
            </>
          ) : failedCount > 0 ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleRetryAllFailed}
              >
                {_('library.uploadRetryAll') || '重试全部'}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => onClose?.()}
              >
                {_('library.done') || '完成'}
              </Button>
            </>
          ) : queueItems.length > 0 ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => onClose?.()}
            >
              {_('library.done') || '完成'}
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled
            >
              {_('library.webdavStartImport') || '开始导入'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
