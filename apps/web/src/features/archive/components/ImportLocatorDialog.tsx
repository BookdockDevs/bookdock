import { useEffect, useMemo, useRef, useState } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import type {
  AnnotationStyle,
  BookListItem,
  ReadingImportLocatorReport,
  ReadingImportLocatorState,
  ReadingImportMountResult,
} from '@bookdock/shared'

import { apiGet, apiPost } from '@/api/client'
import { READING_RECORDS_KEY } from '@/api/hooks/reading-records'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Spinner from '@/components/ui/Spinner'
import BookCover from '@/features/library/components/BookCover'
import { ChatBubbleIcon, HighlighterIcon } from '@/features/reader/components/annotation-icons'
import { annotationHex, highlightDecoration } from '@/features/reader/components/annotation-colors'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'
import { getUserErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

/** Queries keyed by the target book version that a mount silently rewrites. */
const MOUNT_AFFECTED_KEYS = [
  'annotations',
  'reader-ideas',
  'idea-composer',
  'chapters',
  'progress',
  'book',
  'batch-selection',
] as const

function invalidateMountedQueries(queryClient: QueryClient, targetBookVersionId: string) {
  return Promise.all([
    ...MOUNT_AFFECTED_KEYS.map((prefix) => queryClient.invalidateQueries({ queryKey: [prefix, targetBookVersionId] })),
    queryClient.invalidateQueries({ queryKey: ['books'] }),
    queryClient.invalidateQueries({ queryKey: ['shelves'] }),
    queryClient.invalidateQueries({ queryKey: ['archive'] }),
    queryClient.invalidateQueries({ queryKey: ['note-archive'] }),
    queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY }),
  ])
}

const STATE_STYLE: Record<ReadingImportLocatorState, string> = {
  located: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  ambiguous: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  missing: 'bg-stone-500/10 text-stone-600 dark:text-stone-300',
  conflict: 'bg-red-500/10 text-red-700 dark:text-red-400',
}

type FilterState = 'all' | ReadingImportLocatorState

interface ImportLocatorDialogProps {
  archiveId: string
  archiveTitle: string
  onClose: () => void
  embedded?: boolean
  onMounted?: () => void
  onSubpageChange?: (
    isSubpage: boolean,
    title?: string,
    onBack?: () => void,
    footer?: React.ReactNode,
  ) => void
}

export default function ImportLocatorDialog({
  archiveId,
  archiveTitle,
  onClose,
  embedded = false,
  onMounted,
  onSubpageChange,
}: ImportLocatorDialogProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState(archiveTitle?.trim() ?? '')

  useEffect(() => {
    const trimmed = archiveTitle?.trim() ?? ''
    if (trimmed) {
      setSearch((prev) => (prev ? prev : trimmed))
    }
  }, [archiveTitle])
  const [target, setTarget] = useState<BookListItem | null>(null)
  const [activeFilter, setActiveFilter] = useState<FilterState>('all')
  const [mounting, setMounting] = useState(false)
  const [mountError, setMountError] = useState<string | null>(null)

  const booksQuery = useQuery({
    queryKey: ['import-locator-books', search],
    queryFn: () => apiGet<{ data: BookListItem[] }>(`/books?page=1&pageSize=30&search=${encodeURIComponent(search)}`),
    enabled: target === null,
    staleTime: 30_000,
  })

  const reportQuery = useQuery({
    queryKey: ['import-locator-report', archiveId, target?.id],
    queryFn: () => apiPost<{ data: ReadingImportLocatorReport }>(
      `/reading-imports/archives/${encodeURIComponent(archiveId)}/locator-report`,
      { targetBookVersionId: target!.id },
    ),
    enabled: target !== null,
    retry: false,
    staleTime: Infinity,
  })

  const report = reportQuery.data?.data

  const stateLabel = (state: ReadingImportLocatorState): string => {
    if (state === 'located') return _('readingImport.locatorLocated', { defaultValue: '可定位' })
    if (state === 'ambiguous') return _('readingImport.locatorAmbiguous', { defaultValue: '多处命中' })
    if (state === 'conflict') return _('readingImport.locatorConflict', { defaultValue: '位置冲突' })
    return _('readingImport.locatorMissing', { defaultValue: '未匹配' })
  }

  const filteredItems = useMemo(() => {
    if (!report) return []
    if (activeFilter === 'all') return report.items
    return report.items.filter((item) => item.state === activeFilter)
  }, [report, activeFilter])

  async function runMount() {
    if (!target) return
    setMounting(true)
    setMountError(null)
    try {
      const data = (await apiPost<{ data: ReadingImportMountResult }>(
        `/reading-imports/archives/${encodeURIComponent(archiveId)}/mount`,
        { targetBookVersionId: target.id },
      )).data
      await invalidateMountedQueries(queryClient, data.targetBookVersionId)
      useToastStore.getState().addToast(
        _('readingImport.mountSuccess', {
          title: target.title,
          defaultValue: '已成功关联到《{{title}}》',
        }),
        'success',
      )
      if (onMounted) onMounted()
      else onClose()
    } catch (err) {
      setMountError(getUserErrorMessage(err, _, 'readingImport.mountFailed'))
    } finally {
      setMounting(false)
    }
  }

  const runMountRef = useRef(runMount)
  runMountRef.current = runMount

  const footer = useMemo(() => {
    if (!target || !report) return undefined
    return (
      <div className="flex w-full items-center justify-between gap-2">
        <div className="min-w-0">
          {mountError && (
            <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400 truncate">
              {mountError}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={mounting}
          onClick={() => void runMountRef.current()}
          className="cursor-pointer shrink-0"
        >
          {mounting
            ? _('readingImport.mountRunning', { defaultValue: '正在关联…' })
            : _('readingImport.mountConfirm', { defaultValue: '确认关联' })}
        </Button>
      </div>
    )
  }, [target, report, mounting, mountError, _])

  const modalTitle = target
    ? `关联到《${target.title}》`
    : _('readingImport.locatorTitle', { defaultValue: '关联书籍' })

  useEffect(() => {
    const isSub = Boolean(target)
    const title = target ? `关联到《${target.title}》` : _('readingImport.locatorTitle', { defaultValue: '关联书籍' })
    const backAction = target ? () => setTarget(null) : onClose
    onSubpageChange?.(isSub, title, backAction, footer)
  }, [target, onClose, onSubpageChange, footer, _])

  const filterCards: Array<{ key: FilterState; label: string; count: number }> = report ? [
    { key: 'all', label: _('readingImport.filterAll', { defaultValue: '全部' }), count: report.total },
    { key: 'located', label: _('readingImport.locatorLocated', { defaultValue: '可定位' }), count: report.located },
    { key: 'ambiguous', label: _('readingImport.locatorAmbiguous', { defaultValue: '多处命中' }), count: report.ambiguous },
    { key: 'missing', label: _('readingImport.locatorMissing', { defaultValue: '未匹配' }), count: report.missing },
    { key: 'conflict', label: _('readingImport.locatorConflict', { defaultValue: '位置冲突' }), count: report.conflict },
  ] : []

  const body = (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden text-left">
      {target === null ? (
        /* 第一步：选择目标书籍 */
        <div className="flex flex-1 min-h-0 flex-col gap-3">
          {/* 搜索框 */}
          <div className="relative flex items-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 text-stone-400">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={_('readingImport.locatorSearchPlaceholder', { defaultValue: '搜索书名或作者…' })}
              aria-label={_('readingImport.locatorSearchPlaceholder', { defaultValue: '搜索书名或作者…' })}
              className="h-9 w-full rounded-lg border border-stone-200 bg-white pl-9 pr-8 text-xs text-stone-900 outline-none placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-stone-200 text-stone-500 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600 cursor-pointer"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {booksQuery.isPending ? (
            <div
              role="status"
              aria-label={_('readingImport.locatorLoadingBooks', { defaultValue: '正在检索书库…' })}
              className="flex flex-1 flex-col items-center justify-center gap-2.5 py-16 text-stone-400 dark:text-stone-500"
            >
              <Spinner size="md" />
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {_('readingImport.locatorLoadingBooks', { defaultValue: '正在检索书库…' })}
              </p>
            </div>
          ) : booksQuery.isError ? (
            <p role="alert" className="py-12 text-center text-xs text-red-600 dark:text-red-400">
              {getUserErrorMessage(booksQuery.error, _, 'readingImport.locatorFailed')}
            </p>
          ) : (booksQuery.data?.data.length ?? 0) === 0 ? (
            <p className="py-12 text-center text-xs text-stone-400 dark:text-stone-500">
              {_('readingImport.locatorNoBooks', { defaultValue: '没有找到可用的书' })}
            </p>
          ) : (
            <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-stone-100 rounded-xl border border-stone-200/90 dark:divide-stone-800/80 dark:border-stone-800 custom-scrollbar">
              {booksQuery.data!.data.map((book) => (
                <li key={book.id}>
                  <button
                    type="button"
                    onClick={() => setTarget(book)}
                    className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/60"
                  >
                    <div className="shrink-0">
                      <BookCover book={book} size="sm" />
                    </div>
                    <div className="flex h-11 min-w-0 flex-1 flex-col justify-center py-0.5 text-left">
                      <p className="truncate text-xs font-medium text-stone-900 dark:text-stone-100 leading-snug">
                        {book.title}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] leading-snug text-stone-400 dark:text-stone-500 min-h-[15px]">
                        {[book.author, book.format?.toUpperCase()].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        /* 第二步：匹配检查与确认关联 */
        <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-hidden">
          {/* 目标书条目卡片 */}
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-stone-200/80 bg-stone-50/60 p-2.5 dark:border-stone-800 dark:bg-stone-800/40">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="shrink-0">
                <BookCover book={target} size="sm" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-stone-900 dark:text-stone-100 leading-snug">
                  {target.title}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-stone-400 dark:text-stone-500 leading-snug">
                  {[target.author, target.format?.toUpperCase()].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-200/90 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 shadow-2xs hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700/80 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100 cursor-pointer transition-all"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400 dark:text-stone-400">
                <path d="M16 3h5v5" />
                <path d="M4 20L21 3" />
                <path d="M21 16v5h-5" />
                <path d="M15 15l6 6" />
                <path d="M4 4l5 5" />
              </svg>
              <span>{_('readingImport.locatorChangeTarget', { defaultValue: '更换目标' })}</span>
            </button>
          </div>

          {reportQuery.isPending ? (
            <div
              role="status"
              className="flex flex-1 flex-col items-center justify-center gap-2.5 py-12 text-stone-400 dark:text-stone-500"
            >
              <Spinner size="md" />
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {_('readingImport.locatorRunning', { defaultValue: '正在读取正文并逐条匹配…' })}
              </p>
            </div>
          ) : reportQuery.isError ? (
            <p role="alert" className="py-12 text-center text-xs text-red-600 dark:text-red-400">
              {getUserErrorMessage(reportQuery.error, _, 'readingImport.locatorFailed')}
            </p>
          ) : report ? (
            <>
              {/* 五项数值筛选卡片：直接点击数值进行筛选，默认选中全部 */}
              <div className="grid grid-cols-5 gap-1.5 sm:gap-2 shrink-0">
                {filterCards.map(({ key, label, count }) => {
                  const isSelected = activeFilter === key
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={isSelected}
                      onClick={() => setActiveFilter(key)}
                      className={cn(
                        'flex flex-col items-center justify-center rounded-xl border p-2 text-center transition-all cursor-pointer',
                        isSelected
                          ? 'border-stone-900 bg-stone-900 text-stone-50 shadow-2xs dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                          : 'border-stone-200/80 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50/80 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-300 dark:hover:bg-stone-800/60',
                      )}
                    >
                      <span className={cn('text-[11px] font-medium leading-none truncate w-full', isSelected ? 'text-stone-300 dark:text-stone-600' : 'text-stone-500 dark:text-stone-400')}>
                        {label}
                      </span>
                      <span className="mt-1 text-base font-bold tabular-nums sm:text-lg leading-none">
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* 笔记匹配详情列表 */}
              {filteredItems.length === 0 ? (
                <p className="flex-1 py-10 text-center text-xs text-stone-400 dark:text-stone-500">
                  {_('readingImport.locatorEmpty', { defaultValue: '没有符合筛选的条目' })}
                </p>
              ) : (
                <ul className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto pr-2.5 [scrollbar-gutter:stable] custom-scrollbar">
                  {filteredItems.map((item) => {
                    const hex = annotationHex(item.color)
                    const style = (item.style as AnnotationStyle) ?? 'highlight'
                    return (
                      <li key={item.recordId} className="rounded-xl border border-stone-200/80 bg-white p-3 dark:border-stone-800 dark:bg-stone-900/60">
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-start gap-2.5 min-w-0 flex-1">
                            <span
                              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-stone-100 dark:bg-stone-800"
                              style={{ color: hex }}
                            >
                              {item.kind === 'idea' ? <ChatBubbleIcon size={12} /> : <HighlighterIcon size={12} />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-3 text-xs leading-relaxed text-stone-800 dark:text-stone-200">
                                <span style={highlightDecoration(style, hex)}>{item.text}</span>
                              </p>
                              {item.chapter && (
                                <p className="mt-1.5 truncate text-[11px] text-stone-400 dark:text-stone-500">
                                  {item.chapter}
                                </p>
                              )}
                            </div>
                          </div>
                          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', STATE_STYLE[item.state])}>
                            {stateLabel(item.state)}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  )

  if (embedded) {
    return body
  }

  return (
    <Modal
      title={modalTitle}
      onClose={onClose}
      size="default"
      panelClassName="h-[640px] max-h-[88vh] flex flex-col"
      contentClassName="flex flex-col flex-1 min-h-0 !overflow-hidden"
      footer={footer}
    >
      {body}
    </Modal>
  )
}
