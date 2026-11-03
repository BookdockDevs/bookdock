import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { ArchiveDataExport, ReadingImportScope } from '@bookdock/shared'

import { apiDelete, apiGet } from '@/api/client'
import { READING_RECORDS_KEY } from '@/api/hooks/reading-records'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
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
import ReadingImportDialog from './ReadingImportDialog'

interface ReadingDataManagerButtonProps {
  bookId?: string
  bookTitle?: string
  onBookDeleted?: () => void
  className?: string
}

type ManagerTab = 'import' | 'export' | 'manage'

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
  const username = useAuthStore((s) => s.user?.username)
  const [modalOpen, setModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<ManagerTab>('import')
  const [isImportSubpage, setIsImportSubpage] = useState(false)
  const [importSubpageTitle, setImportSubpageTitle] = useState<string | null>(null)
  const [importBackAction, setImportBackAction] = useState<(() => void) | null>(null)
  const [importSubpageActions, setImportSubpageActions] = useState<React.ReactNode | null>(null)

  // 导出相关状态
  const [exportScope, setExportScope] = useState<ReadingImportScope>('all')
  const [exportFormat, setExportFormat] = useState<ArchiveExportFormat>('json')
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // 管理相关状态
  const [isLocatorSubpage, setIsLocatorSubpage] = useState(false)
  const [locatorSubpageTitle, setLocatorSubpageTitle] = useState<string | null>(null)
  const [locatorBackAction, setLocatorBackAction] = useState<(() => void) | null>(null)
  const [locatorFooter, setLocatorFooter] = useState<React.ReactNode | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmBusy, setDeleteConfirmBusy] = useState(false)

  const isSubpage = (activeTab === 'import' && isImportSubpage) || (activeTab === 'manage' && isLocatorSubpage)

  const title = (activeTab === 'import' && importSubpageTitle)
    ? importSubpageTitle
    : (activeTab === 'manage' && locatorSubpageTitle)
      ? locatorSubpageTitle
      : _('readingData.archiveManagement', { defaultValue: '阅读档案管理' })

  const headerTitle = (activeTab === 'import' && isImportSubpage && importSubpageTitle) ? (
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
    setExportFormat((current) => narrowArchiveExportFormat(next, current))
  }

  async function handleExport() {
    setExportBusy(true)
    setExportError(null)
    try {
      const params = new URLSearchParams({ scope: exportScope })
      if (bookId) params.set('bookId', bookId)
      const result = await apiGet<{ data: ArchiveDataExport }>(`/archive/data-export?${params}`)
      download(
        `${archiveExportFilename({ scope: exportScope, bookTitle, username }, _)}.${archiveExportExtension(exportFormat)}`,
        buildArchiveExportFile(exportFormat, result.data, _),
        archiveExportMime(exportFormat),
      )
    } catch (err) {
      setExportError(getUserErrorMessage(err, _, 'reader.sessionActionFailed'))
    } finally {
      setExportBusy(false)
    }
  }

  function handleClose() {
    setModalOpen(false)
    setActiveTab('import')
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
          setActiveTab('import')
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
            {!isSubpage && (
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
                  onClick={() => setActiveTab('import')}
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
                  onClick={() => setActiveTab('export')}
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
                    onClick={() => setActiveTab('manage')}
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
            {activeTab === 'import' && (
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
            {activeTab === 'export' && (
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
                          onClick={() => setExportFormat(value)}
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
              isLocatorSubpage ? (
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
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-stone-200/90 bg-stone-50/40 p-3.5 dark:border-stone-800 dark:bg-stone-900/40">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                        {_('readingImport.locatorTitle', { defaultValue: '关联书籍' })}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
                        {_('readingImport.locatorHint', { defaultValue: '将此档案的笔记、书评与时长关联到书库中的书籍。' })}
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
                  </div>

                  {/* 2. 危险操作卡片 */}
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200/60 bg-red-50/20 p-3.5 dark:border-red-950/40 dark:bg-red-950/10">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                        {_('readingData.deleteArchive', { defaultValue: '删除本书阅读档案' })}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
                        {_('readingData.deleteArchiveDesc', { defaultValue: '永久清除此档案的所有笔记与时长记录。' })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={deleteConfirmBusy}
                      onClick={() => setDeleteConfirmOpen(true)}
                      className="shrink-0 cursor-pointer"
                    >
                      {_('reader.sessionDelete', { defaultValue: '删除档案' })}
                    </Button>
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
          title={_('readingData.deleteArchive')}
          message={_('readingData.deleteArchiveConfirm')}
          confirmLabel={_('reader.sessionDelete')}
          errorFallback="reader.sessionActionFailed"
          confirmDisabled={deleteConfirmBusy}
          onClose={() => {
            if (!deleteConfirmBusy) setDeleteConfirmOpen(false)
          }}
          onConfirm={async () => {
            if (!bookId) return
            setDeleteConfirmBusy(true)
            try {
              await apiDelete(`/reading-records/book/${encodeURIComponent(bookId)}/ledger`)
              void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
              void queryClient.invalidateQueries({ queryKey: ['archive'] })
              void queryClient.invalidateQueries({ queryKey: ['progress', bookId] })
              void queryClient.invalidateQueries({ queryKey: ['book', bookId] })
              setDeleteConfirmOpen(false)
              handleClose()
              onBookDeleted?.()
            } finally {
              setDeleteConfirmBusy(false)
            }
          }}
        />
      )}
    </>
  )
}
