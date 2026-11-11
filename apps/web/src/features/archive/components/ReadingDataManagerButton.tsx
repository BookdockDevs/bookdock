import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { ArchiveDataExport, ArchiveDeleteRes, ClientReadingLedgerClear, ReadingImportScope } from '@bookdock/shared'

import { deviceCatalogOperations } from '@/features/local-library/catalog'
import { localRecordId } from '@/features/local-library/id'
import { getAuthSessionRevision } from '@/stores/auth.store'
import { apiDelete, apiGet } from '@/api/client'
import { READING_RECORDS_KEY } from '@/api/hooks/reading-records'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import {
  ARCHIVE_EXPORT_FORMATS_BY_SCOPE,
  archiveExportExtension,
  archiveExportFilename,
  archiveExportFormatLabel,
  archiveExportMime,
  buildArchiveExportFile,
  narrowArchiveExportFormat,
  type ArchiveExportFormat,
} from '../lib/data-export-file'
import ImportLocatorDialog from './ImportLocatorDialog'
import { readSavedChoice, writeSavedChoice } from './archive-helpers'
import { useLocalArchiveBook } from '../hooks'
import ReadingImportDialog from './ReadingImportDialog'

interface ReadingDataManagerButtonProps {
  bookId?: string
  bookTitle?: string
  onBookDeleted?: () => void
  className?: string
}

type ManagerTab = 'import' | 'export' | 'manage'

const MANAGER_TAB_STORAGE_KEY = 'bd-reading-data-manager-tab'
const EXPORT_SCOPE_STORAGE_KEY = 'bd-reading-data-export-scope'
const EXPORT_FORMAT_STORAGE_KEY = 'bd-reading-data-export-format'
const DELETE_SCOPE_STORAGE_KEY = 'bd-reading-data-delete-scope'

const MANAGER_TABS: readonly ManagerTab[] = ['import', 'export', 'manage']
const READING_SCOPES: readonly ReadingImportScope[] = ['all', 'time', 'notes']
const EXPORT_FORMATS: readonly ArchiveExportFormat[] = ['json', 'markdown', 'text', 'csv']

const DELETE_COPY_BY_SCOPE: Record<ReadingImportScope, {
  titleKey: string
  titleFallback: string
  descKey: string
  descFallback: string
  actionKey: string
  actionFallback: string
  confirmKey: string
  confirmFallback: string
}> = {
  all: {
    titleKey: 'readingData.deleteAllTitle',
    titleFallback: '删除本书阅读档案',
    descKey: 'readingData.deleteAllDesc',
    descFallback: '永久删除此档案的时长、统计与全部笔记，书库书籍与阅读位置会保留。',
    actionKey: 'readingData.deleteAllAction',
    actionFallback: '删除档案',
    confirmKey: 'readingData.deleteAllConfirm',
    confirmFallback: '确定永久删除此档案的全部阅读时长、统计与笔记吗？书库书籍与阅读位置会保留，此操作无法撤销。',
  },
  time: {
    titleKey: 'readingData.deleteTimeTitle',
    titleFallback: '删除本书阅读时长',
    descKey: 'readingData.deleteTimeDesc',
    descFallback: '永久删除此档案的时长、轮次与统计数据，笔记与阅读位置会保留。',
    actionKey: 'readingData.deleteTimeAction',
    actionFallback: '删除时长',
    confirmKey: 'readingData.deleteTimeConfirm',
    confirmFallback: '确定永久删除此档案的阅读时长、轮次与统计数据吗？笔记与阅读位置会保留，此操作无法撤销。',
  },
  notes: {
    titleKey: 'readingData.deleteNotesTitle',
    titleFallback: '删除本书阅读笔记',
    descKey: 'readingData.deleteNotesDesc',
    descFallback: '永久删除此档案的笔记数据，阅读时长与阅读位置会保留。',
    actionKey: 'readingData.deleteNotesAction',
    actionFallback: '删除笔记',
    confirmKey: 'readingData.deleteNotesConfirm',
    confirmFallback: '确定永久删除此档案的全部笔记吗？阅读时长与阅读位置会保留，此操作无法撤销。',
  },
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ReadingDataManagerButton({
  bookId,
  bookTitle,
  onBookDeleted,
  className,
}: ReadingDataManagerButtonProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const presence = useLocalArchiveBook(bookId ?? null)
  // Device operations follow the selected book, not the route: a device book
  // opened from the unified archive still clears through the vault.
  const isLocalBook = presence.data === true
  const device = useMemo(() => (isLocalBook ? deviceCatalogOperations() : null), [isLocalBook])
  const account = useAuthStore((state) => state.user)
  const username = account?.username
  const [modalOpen, setModalOpen] = useState(false)
  // The vault answers whether the selected book is on this device, so device
  // books always open on 'manage'; otherwise restore the reader's last tab.
  const [chosenTab, setChosenTab] = useState<ManagerTab | null>(() => readSavedChoice(MANAGER_TAB_STORAGE_KEY, MANAGER_TABS))
  const rawTab = chosenTab ?? 'import'
  const activeTab: ManagerTab = device
    ? 'manage'
    : (!bookId && rawTab === 'manage')
      ? 'import'
      : rawTab
  const [isImportSubpage, setIsImportSubpage] = useState(false)
  const [importSubpageTitle, setImportSubpageTitle] = useState<string | null>(null)
  const [importBackAction, setImportBackAction] = useState<(() => void) | null>(null)
  const [importSubpageActions, setImportSubpageActions] = useState<React.ReactNode | null>(null)

  // 导出相关状态
  const [exportScope, setExportScope] = useState<ReadingImportScope>(() => readSavedChoice(EXPORT_SCOPE_STORAGE_KEY, READING_SCOPES, 'all'))
  const [rawExportFormat, setRawExportFormat] = useState<ArchiveExportFormat>(() => readSavedChoice(EXPORT_FORMAT_STORAGE_KEY, EXPORT_FORMATS, 'json'))
  const exportFormat = narrowArchiveExportFormat(exportScope, rawExportFormat)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // 管理相关状态
  const [isLocatorSubpage, setIsLocatorSubpage] = useState(false)
  const [locatorSubpageTitle, setLocatorSubpageTitle] = useState<string | null>(null)
  const [locatorBackAction, setLocatorBackAction] = useState<(() => void) | null>(null)
  const [locatorFooter, setLocatorFooter] = useState<React.ReactNode | null>(null)
  const [deleteScope, setDeleteScope] = useState<ReadingImportScope>(() => readSavedChoice(DELETE_SCOPE_STORAGE_KEY, READING_SCOPES, 'all'))
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmBusy, setDeleteConfirmBusy] = useState(false)
  const [clearCommand, setClearCommand] = useState<ClientReadingLedgerClear | null>(null)
  // The reset below is about the panel's own subpages, so it keys on the book and
  // the session. The device lookup resolves a moment after mount; folding it in
  // would look like a scope change and close the panel right after opening it.
  const scope = JSON.stringify([getAuthSessionRevision(), bookId ?? null])
  const activeScope = useRef(scope)
  activeScope.current = scope
  const [previousScope, setPreviousScope] = useState(scope)
  if (previousScope !== scope) {
    setPreviousScope(scope); handleClose(); setDeleteConfirmOpen(false); setDeleteConfirmBusy(false); setClearCommand(null)
  }
  const clearPreview = useQuery({
    queryKey: ['reading-records', device ? `device:${JSON.stringify(device.scope)}` : null, 'clear-preview', bookId],
    queryFn: async () => {
      const snapshot = await device!.readReadingSnapshot()
      const book = snapshot.books.find((book) => book.book.ref.bookId === bookId)
      if (!book) throw new Error('Local book no longer exists')
      return book.ledger.version
    },
    networkMode: 'always', enabled: Boolean(device && modalOpen && bookId), staleTime: 0,
  })
  const deleteCopy = DELETE_COPY_BY_SCOPE[deleteScope]
  const deleteTitle = _(deleteCopy.titleKey, { defaultValue: deleteCopy.titleFallback })


  const isSubpage = (!device && activeTab === 'import' && isImportSubpage) || (activeTab === 'manage' && isLocatorSubpage)

  const title = (!device && activeTab === 'import' && importSubpageTitle)
    ? importSubpageTitle
    : (activeTab === 'manage' && locatorSubpageTitle)
      ? locatorSubpageTitle
      : _('readingData.archiveManagement', { defaultValue: '阅读档案管理' })

  const headerTitle = (!device && activeTab === 'import' && isImportSubpage && importSubpageTitle) ? (
    <div className="flex items-center gap-1.5">
      {importBackAction && (
        <button
          type="button"
          onClick={importBackAction}
          className="-ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 cursor-pointer"
          aria-label={_('readingImport.backToConfig', { defaultValue: '返回' })}
          title={_('readingImport.backToConfig', { defaultValue: '返回' })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}
      <span className="truncate">{importSubpageTitle}</span>
    </div>
  ) : (activeTab === 'manage' && isLocatorSubpage && locatorSubpageTitle) ? (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={locatorBackAction ?? (() => setIsLocatorSubpage(false))}
        className="-ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 cursor-pointer"
        aria-label={_('readingImport.backToConfig', { defaultValue: '返回' })}
        title={_('readingImport.backToConfig', { defaultValue: '返回' })}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <span className="truncate">{locatorSubpageTitle}</span>
    </div>
  ) : title

  function selectExportScope(next: ReadingImportScope) {
    setExportScope(next)
    writeSavedChoice(EXPORT_SCOPE_STORAGE_KEY, next)
  }

  function selectExportFormat(next: ArchiveExportFormat) {
    setRawExportFormat(next)
    writeSavedChoice(EXPORT_FORMAT_STORAGE_KEY, next)
  }

  function selectDeleteScope(next: ReadingImportScope) {
    setDeleteScope(next)
    writeSavedChoice(DELETE_SCOPE_STORAGE_KEY, next)
  }

  async function handleExport() {
    if (device) return
    setExportBusy(true)
    setExportError(null)
    try {
      const params = new URLSearchParams({ scope: exportScope })
      if (bookId) params.set('bookId', bookId)
      const result = await apiGet<{ data: ArchiveDataExport }>(`/archive/data-export?${params}`)
      if (activeScope.current !== scope) return
      download(
        `${archiveExportFilename({ scope: exportScope, bookTitle, username }, _)}.${archiveExportExtension(exportFormat)}`,
        buildArchiveExportFile(exportFormat, result.data, _),
        archiveExportMime(exportFormat),
      )
    } catch (err) {
      if (activeScope.current === scope) setExportError(getUserErrorMessage(err, _, 'reader.sessionActionFailed'))
    } finally {
      if (activeScope.current === scope) setExportBusy(false)
    }
  }

  function selectTab(next: ManagerTab) {
    setChosenTab(next)
    writeSavedChoice(MANAGER_TAB_STORAGE_KEY, next)
  }

  function handleClose() {
    setModalOpen(false)
    setIsImportSubpage(false)
    setImportSubpageTitle(null)
    setImportBackAction(null)
    setImportSubpageActions(null)
    setIsLocatorSubpage(false)
    setLocatorSubpageTitle(null)
    setLocatorBackAction(null)
    setLocatorFooter(null)
  }

  const exportActionLabel = bookId
    ? (exportScope === 'all'
        ? _('readingData.exportBookArchive', { defaultValue: '导出本书档案' })
        : exportScope === 'time'
          ? _('readingData.exportBookTime', { defaultValue: '导出本书时长' })
          : _('readingData.exportBookNotes', { defaultValue: '导出本书笔记' }))
    : (exportScope === 'all'
        ? _('readingData.exportAllArchives', { defaultValue: '导出全部档案' })
        : exportScope === 'time'
          ? _('readingData.exportAllTime', { defaultValue: '导出全部时长' })
          : _('readingData.exportAllNotes', { defaultValue: '导出全部笔记' }))

  return (
    <>
      <button
        type="button"
        aria-label={title}
        title={title}
        onClick={() => {
          setChosenTab(readSavedChoice(MANAGER_TAB_STORAGE_KEY, MANAGER_TABS))
          setExportScope(readSavedChoice(EXPORT_SCOPE_STORAGE_KEY, READING_SCOPES, 'all'))
          setRawExportFormat(readSavedChoice(EXPORT_FORMAT_STORAGE_KEY, EXPORT_FORMATS, 'json'))
          setDeleteScope(readSavedChoice(DELETE_SCOPE_STORAGE_KEY, READING_SCOPES, 'all'))
          setModalOpen(true)
        }}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-300 cursor-pointer',
          className,
        )}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m3 8 4-4 4 4" />
          <path d="M7 4v16" />
          <path d="m21 16-4 4-4-4" />
          <path d="M17 20V4" />
        </svg>
      </button>

      {modalOpen && (
        <Modal
          title={headerTitle}
          onClose={handleClose}
          size="default"
          actions={isImportSubpage ? importSubpageActions : undefined}
          footer={isLocatorSubpage ? (locatorFooter ?? undefined) : undefined}
          panelClassName={isSubpage ? 'h-[640px] max-h-[88vh] flex flex-col' : undefined}
          contentClassName={isSubpage ? 'flex flex-col flex-1 min-h-0 !overflow-hidden' : undefined}
        >
          <div className={cn('flex flex-col gap-4', isSubpage && 'flex-1 min-h-0')}>
            {/* 顶层 Segmented Tabs（选书或结果子页时隐藏，留出完整高度） */}
            {!device && !isSubpage && (
              <div
                role="tablist"
                aria-label={_('readingData.tabsLabel', { defaultValue: '数据管理选项' })}
                className="grid w-full rounded-xl bg-stone-100 p-1 dark:bg-stone-800/80"
                style={{ gridTemplateColumns: bookId ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))' }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'import'}
                  onClick={() => selectTab('import')}
                  className={cn(
                    'cursor-pointer rounded-lg py-1.5 text-xs font-semibold transition-all',
                    activeTab === 'import'
                      ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                      : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                  )}
                >
                  {_('readingData.tabImport', { defaultValue: '导入数据' })}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'export'}
                  onClick={() => selectTab('export')}
                  className={cn(
                    'cursor-pointer rounded-lg py-1.5 text-xs font-semibold transition-all',
                    activeTab === 'export'
                      ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                      : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                  )}
                >
                  {_('readingData.tabExport', { defaultValue: '导出数据' })}
                </button>
                {bookId && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'manage'}
                    onClick={() => selectTab('manage')}
                    className={cn(
                      'cursor-pointer rounded-lg py-1.5 text-xs font-semibold transition-all',
                      activeTab === 'manage'
                        ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                        : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                    )}
                  >
                    {_('readingData.tabManage', { defaultValue: '管理数据' })}
                  </button>
                )}
              </div>
            )}

            {/* TAB 1: 导入数据 */}
            {!device && activeTab === 'import' && (
              <ReadingImportDialog
                embedded
                onClose={handleClose}
                onSubpageChange={(subpage, subTitle, onBack, actions) => {
                  setIsImportSubpage(subpage)
                  setImportSubpageTitle(subTitle ?? null)
                  setImportBackAction(onBack ? () => onBack : null)
                  setImportSubpageActions(actions ?? null)
                }}
              />
            )}

            {/* TAB 2: 导出数据（方案 B：左右表单行布局） */}
            {!device && activeTab === 'export' && (
              <div className="flex flex-col gap-4 text-left py-1">
                <div className="flex flex-col gap-3 rounded-xl border border-stone-200/80 bg-stone-50/40 p-3.5 dark:border-stone-800 dark:bg-stone-900/40">
                  {/* 导出范围行 */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                      {_('readingData.exportScopeTitle', { defaultValue: '导出范围' })}
                    </span>
                    <div
                      role="radiogroup"
                      aria-label={_('readingData.scopeLabel', { defaultValue: '导出范围' })}
                      className="inline-flex rounded-lg bg-stone-200/60 p-0.5 dark:bg-stone-800"
                    >
                      {([
                        ['all', 'readingData.scopeAll', '全部'],
                        ['time', 'readingData.scopeTime', '时长'],
                        ['notes', 'readingData.scopeNotes', '笔记'],
                      ] as const).map(([key, labelKey, fallback]) => (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={exportScope === key}
                          onClick={() => selectExportScope(key)}
                          className={cn(
                            'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                            exportScope === key
                              ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                              : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                          )}
                        >
                          {_(labelKey, { defaultValue: fallback })}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="h-px w-full bg-stone-200/60 dark:bg-stone-800" />

                  {/* 导出格式行 */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                      {_('readingData.exportFormatLabel', { defaultValue: '导出格式' })}
                    </span>
                    <div
                      role="radiogroup"
                      aria-label={_('readingData.exportFormatLabel', { defaultValue: '导出格式' })}
                      className="inline-flex rounded-lg bg-stone-200/60 p-0.5 dark:bg-stone-800"
                    >
                      {ARCHIVE_EXPORT_FORMATS_BY_SCOPE[exportScope].map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={exportFormat === value}
                          onClick={() => selectExportFormat(value)}
                          className={cn(
                            'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                            exportFormat === value
                              ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                              : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                          )}
                        >
                          {archiveExportFormatLabel(value, _)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {exportError && (
                  <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">{exportError}</p>
                )}

                {/* 底部通栏大操作按钮 */}
                <Button
                  size="lg"
                  variant="primary"
                  disabled={exportBusy}
                  onClick={() => void handleExport()}
                  className="mt-1 w-full justify-center gap-2 py-2.5 text-xs font-semibold cursor-pointer"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {exportBusy ? _('readingData.exporting', { defaultValue: '正在导出…' }) : exportActionLabel}
                </Button>
              </div>
            )}

            {/* TAB 3: 管理数据（定位检查与删除档案） */}
            {activeTab === 'manage' && bookId && (
              !device && isLocatorSubpage ? (
                <ImportLocatorDialog
                  embedded
                  archiveId={bookId}
                  archiveTitle={bookTitle ?? ''}
                  onClose={() => setIsLocatorSubpage(false)}
                  onMounted={() => {
                    setIsLocatorSubpage(false)
                    handleClose()
                  }}
                  onSubpageChange={(_isSub, subTitle, onBack, subFooter) => {
                    setLocatorSubpageTitle(subTitle ?? null)
                    setLocatorBackAction(onBack ? () => onBack : null)
                    setLocatorFooter(subFooter ?? null)
                  }}
                />
              ) : (
                <div className="flex flex-col gap-3.5 text-left">
                  {/* 1. 关联书籍卡片 */}
                  {!device && <div className="flex items-center justify-between gap-3 rounded-xl border border-stone-200/90 bg-stone-50/40 p-3.5 dark:border-stone-800 dark:bg-stone-900/40">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                        {_('readingImport.locatorTitle', { defaultValue: '关联书籍' })}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
                        {_('readingImport.locatorHint', { defaultValue: '将此档案的阅读时长与笔记关联到书库中的书籍。' })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setIsLocatorSubpage(true)}
                      className="shrink-0 cursor-pointer"
                    >
                      {_('readingImport.locatorAction', { defaultValue: '关联' })}
                    </Button>
                  </div>}

                  {device && clearPreview.isError && <QueryErrorState isRetrying={clearPreview.isFetching} onRetry={() => void clearPreview.refetch()} />}

                  {/* 2. 危险操作卡片（对齐导出的 全部 / 时长 / 笔记 三种范围） */}
                  <div className="flex flex-col gap-3 rounded-xl border border-red-200/60 bg-red-50/20 p-3.5 dark:border-red-950/40 dark:bg-red-950/10">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                        {_('readingData.deleteArchive', { defaultValue: '删除本书阅读档案' })}
                      </span>
                      <div
                        role="radiogroup"
                        aria-label={_('readingData.deleteScopeLabel', { defaultValue: '删除范围' })}
                        className="inline-flex rounded-lg bg-red-100/70 p-0.5 dark:bg-red-950/50"
                      >
                        {([
                          ['all', 'readingData.scopeAll', '全部'],
                          ['time', 'readingData.scopeTime', '时长'],
                          ['notes', 'readingData.scopeNotes', '笔记'],
                        ] as const).map(([key, labelKey, fallback]) => (
                          <button
                            key={key}
                            type="button"
                            role="radio"
                            aria-checked={deleteScope === key}
                            onClick={() => selectDeleteScope(key)}
                            className={cn(
                              'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                              deleteScope === key
                                ? 'bg-white text-red-700 shadow-2xs dark:bg-stone-800 dark:text-red-300'
                                : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                            )}
                          >
                            {_(labelKey, { defaultValue: fallback })}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="h-px w-full bg-red-200/50 dark:bg-red-950/50" />

                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
                        {_(deleteCopy.descKey, { defaultValue: deleteCopy.descFallback })}
                      </p>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={deleteConfirmBusy || Boolean(device && deleteScope !== 'notes' && !clearPreview.isSuccess)}
                        onClick={() => {
                          if (device) {
                            if (!bookId || (deleteScope !== 'notes' && clearPreview.data === undefined)) return
                            setClearCommand({
                              book: { scope: device.scope, bookId },
                              expectedVersion: clearPreview.data ?? 0,
                              requestId: localRecordId(),
                              scope: deleteScope,
                            })
                          }
                          setDeleteConfirmOpen(true)
                        }}
                        className="shrink-0 cursor-pointer"
                      >
                        {_(deleteCopy.actionKey, { defaultValue: deleteCopy.actionFallback })}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </Modal>
      )}

      {/* 删除确认弹窗 */}
      {deleteConfirmOpen && (
        <ConfirmDialog
          title={deleteTitle}
          message={_(deleteCopy.confirmKey, { defaultValue: deleteCopy.confirmFallback })}
          confirmLabel={_(deleteCopy.actionKey, { defaultValue: deleteCopy.actionFallback })}
          errorFallback="reader.sessionActionFailed"
          confirmDisabled={deleteConfirmBusy}
          onClose={() => {
            if (!deleteConfirmBusy) setDeleteConfirmOpen(false)
          }}
          onConfirm={async () => {
            if (!bookId) return
            setDeleteConfirmBusy(true)
            try {
              if (device) {
                if (!clearCommand) return
                const result = await device.clearBookArchive(clearCommand)
                if (activeScope.current !== scope) return
                const deviceScopeKey = JSON.stringify(device.scope)
                void queryClient.invalidateQueries({
                  predicate: (query) => query.queryKey.some((part) => typeof part === 'string' && (part.startsWith('device:') || part.startsWith('local:')) && part.includes(deviceScopeKey)),
                })
                void queryClient.invalidateQueries({ queryKey: ['archive'] })
                void queryClient.invalidateQueries({ queryKey: ['local-library'] })
                setDeleteConfirmOpen(false)
                setClearCommand(null)
                handleClose()
                if (!result.remaining) onBookDeleted?.()
                return
              }
              const result = await apiDelete<{ data?: ArchiveDeleteRes }>(`/archive/books/${encodeURIComponent(bookId)}?scope=${deleteScope}`)
              if (activeScope.current !== scope) return
              void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
              void queryClient.invalidateQueries({ queryKey: ['archive'] })
              void queryClient.invalidateQueries({ queryKey: ['progress', bookId] })
              void queryClient.invalidateQueries({ queryKey: ['book', bookId] })
              if (deleteScope !== 'time') {
                void queryClient.invalidateQueries({ queryKey: ['annotations'] })
                void queryClient.invalidateQueries({ queryKey: ['note-archive'] })
                void queryClient.invalidateQueries({ queryKey: ['reader-ideas', bookId] })
                void queryClient.invalidateQueries({ queryKey: ['idea-discussion'] })
                void queryClient.invalidateQueries({ queryKey: ['reviews'] })
                void queryClient.invalidateQueries({ queryKey: ['notifications'] })
              }
              setDeleteConfirmOpen(false)
              handleClose()
              if (result?.data?.remaining === false) onBookDeleted?.()
            } catch (error) {
              if (device && activeScope.current === scope) void clearPreview.refetch()
              throw error
            } finally {
              if (activeScope.current === scope) setDeleteConfirmBusy(false)
            }
          }}
        />
      )}
    </>
  )
}
