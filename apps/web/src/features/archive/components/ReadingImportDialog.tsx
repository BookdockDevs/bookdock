import { useEffect, useMemo, useRef, useState } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  MetadataConfiguration,
  ReadingImportBookList,
  ReadingImportBookStatus,
  ReadingImportConflict,
  ReadingImportPreview,
  ReadingImportResult,
  ReadingImportScope,
  ReadingImportSource,
} from '@bookdock/shared'

import { apiGet, apiPost, apiUpload } from '@/api/client'
import { READING_RECORDS_KEY } from '@/api/hooks/reading-records'
import { Button } from '@/components/ui/Button'
import Checkbox from '@/components/ui/Checkbox'
import Modal from '@/components/ui/Modal'
import Spinner from '@/components/ui/Spinner'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'
import { useToastStore } from '@/stores/toast.store'
import { cn } from '@/lib/utils'

import WereadWebLoginControls from './WereadWebLoginControls'

interface ReadingImportDialogProps {
  onClose: () => void
  embedded?: boolean
  onSubpageChange?: (
    isSubpage: boolean,
    title?: string,
    onBack?: () => void,
    actions?: React.ReactNode,
  ) => void
}

const SCOPES: Array<{ value: ReadingImportScope; labelKey: string; fallback: string }> = [
  { value: 'all', labelKey: 'readingImport.scopeAll', fallback: '全部' },
  { value: 'time', labelKey: 'readingImport.scopeTime', fallback: '时长' },
  { value: 'notes', labelKey: 'readingImport.scopeNotes', fallback: '笔记' },
]

type BookFilter = 'all' | ReadingImportBookStatus
type WereadChannel = 'skill' | 'web'

const SOURCE_STORAGE_KEY = 'bd-reading-import-source'
const WEREAD_CHANNEL_STORAGE_KEY = 'bd-reading-import-weread-channel'

function getSavedSource(): ReadingImportSource {
  try {
    const saved = localStorage.getItem(SOURCE_STORAGE_KEY)
    if (saved === 'weread' || saved === 'legado') return saved
  } catch {
    // ignore
  }
  return 'weread'
}

function getSavedWereadChannel(): WereadChannel {
  try {
    const saved = localStorage.getItem(WEREAD_CHANNEL_STORAGE_KEY)
    if (saved === 'skill' || saved === 'web') return saved
  } catch {
    // ignore
  }
  return 'skill'
}

const FILTERS: Array<{ value: BookFilter; labelKey: string; fallback: string }> = [
  { value: 'all', labelKey: 'readingImport.filterAll', fallback: '全部' },
  { value: 'new', labelKey: 'readingImport.statusNew', fallback: '未导入' },
  { value: 'imported', labelKey: 'readingImport.statusImported', fallback: '已导入' },
  { value: 'mounted', labelKey: 'readingImport.statusMounted', fallback: '已关联' },
]

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}


function LegadoIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="22 22 64 64" fill="currentColor" className={className} aria-hidden="true">
      <path d="M55.659 79.068c-1.258 0-2.521-.094-3.753-.279-.773-.115-1.307-.838-1.19-1.611.117-.773.841-1.311 1.612-1.191 1.093.164 2.214.248 3.331.248 12.261 0 22.235-9.975 22.235-22.235 0-12.26-9.975-22.234-22.235-22.234-10.531 0-19.695 7.479-21.79 17.781-.155.768-.902 1.262-1.671 1.107-.767-.156-1.263-.904-1.106-1.672 2.361-11.618 12.693-20.051 24.567-20.051 13.823 0 25.069 11.246 25.069 25.068 0 13.822-11.247 25.068-25.07 25.068z" />
      <circle cx="53.445" cy="48.757" r="3.5" />
      <circle cx="66.861" cy="48.757" r="3.5" />
      <path d="M30.986 53.461s-3.656-1.06-3.656 1.636c0 2.693 0 15.295 0 15.295s-.674 2.598 2.598 3.369c3.271.77 7.697 2.404 7.697 2.404s3.464.387 5.58-.479c2.116-.867 7.505-2.215 7.505-2.215s2.213-.383 2.213-3.656c0-3.271 0-14.24 0-14.24s-.771-3.366-4.233-1.922c-3.464 1.444-5.869 2.118-5.869 2.118s-4.33.48-6.157-.385c-1.826-.863-5.674-1.921-5.674-1.921zm8.772 20.547c-.783 0-1.418-.635-1.418-1.418v-12.5c0-.783.635-1.416 1.418-1.416s1.418.633 1.418 1.416v12.5c0 .783-.635 1.418-1.418 1.418z" />
    </svg>
  )
}

function resolveCoverUrl(url: string | null): string | null {
  if (!url) return null
  // 微信读书封面常含防盗链或特殊响应头，统一走代理剥离安全返回
  if (
    url.includes('_parsecover') ||
    url.includes('qq.com') ||
    url.includes('myqcloud.com')
  ) {
    return `/api/v1/reading-imports/cover-proxy?url=${encodeURIComponent(url)}`
  }
  return url
}

function ImportBookCover({
  coverUrl,
  title,
}: {
  coverUrl: string | null
  title: string
}) {
  const [hasError, setHasError] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const resolved = resolveCoverUrl(coverUrl)

  useEffect(() => {
    setHasError(false)
    setIsLoaded(false)
  }, [coverUrl])

  return (
    <div
      className="relative flex h-11 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-stone-200/80 bg-stone-100 text-stone-400 shadow-2xs dark:border-stone-700/80 dark:bg-stone-800 dark:text-stone-500"
      title={title}
    >
      {/* 占位图：在图片加载完成前始终显示书籍图标，防止浏览器在未完成加载时将 alt 挤压在 32px 容器内 */}
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('transition-opacity duration-150', isLoaded && !hasError ? 'opacity-0' : 'opacity-100')}
        aria-hidden="true"
      >
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
        <path d="M6 6h10" />
        <path d="M6 10h10" />
      </svg>

      {resolved && !hasError && (
        <img
          src={resolved}
          alt={title}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-150',
            isLoaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  )
}

export default function ReadingImportDialog({
  onClose,
  embedded = false,
  onSubpageChange,
}: ReadingImportDialogProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()

  const configQuery = useQuery({
    queryKey: ['metadata-lookup', 'config'],
    queryFn: () => apiGet<{ data: MetadataConfiguration }>('/integrations/metadata-lookup/config'),
    staleTime: 60_000,
  })
  const [source, setSource] = useState<ReadingImportSource>(getSavedSource)
  const [wereadChannel, setWereadChannel] = useState<WereadChannel>(getSavedWereadChannel)
  const isSkillNotConfigured =
    source === 'weread' &&
    wereadChannel === 'skill' &&
    configQuery.isSuccess &&
    !configQuery.data?.data?.weread
  const [scope, setScope] = useState<ReadingImportScope>('all')
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ReadingImportPreview | null>(null)
  const [conflictNoticeList, setConflictNoticeList] = useState<ReadingImportConflict[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<BookFilter>('all')
  const [bookQuery, setBookQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const lastClickedKeyRef = useRef<string | null>(null)

  const [list, setList] = useState<ReadingImportBookList | null>(null)
  const [fetched, setFetched] = useState<Set<string>>(new Set())
  const [listError, setListError] = useState<unknown>(null)
  const listRequest = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function resetPreview() {
    setPreview(null)
    setConflictNoticeList(null)
    setSelected(new Set())
    setFilter('all')
    setBookQuery('')
    setSearchOpen(false)
    lastClickedKeyRef.current = null
  }

  function switchSource(next: ReadingImportSource) {
    listRequest.current++
    setSource(next)
    try {
      localStorage.setItem(SOURCE_STORAGE_KEY, next)
    } catch {
      // ignore
    }
    setList(null)
    setListError(null)
    resetPreview()
    setError(null)
  }

  function switchWereadChannel(next: WereadChannel) {
    listRequest.current++
    setWereadChannel(next)
    try {
      localStorage.setItem(WEREAD_CHANNEL_STORAGE_KEY, next)
    } catch {
      // ignore
    }
    setList(null)
    setListError(null)
    if (next === 'skill') setScope('all')
    resetPreview()
    setError(null)
  }

  async function loadBookList() {
    const request = ++listRequest.current
    setBusy(true)
    setList(null)
    setListError(null)
    resetPreview()
    try {
      const response = await apiPost<{ data: ReadingImportBookList }>('/reading-imports/weread/books', {
        channel: wereadChannel,
        scope: source === 'weread' && wereadChannel === 'skill' ? 'all' : scope,
      })
      if (listRequest.current === request) setList(response.data)
    } catch (err) {
      if (listRequest.current === request) setListError(err)
    } finally {
      if (listRequest.current === request) setBusy(false)
    }
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['archive'] })
    void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
    void queryClient.invalidateQueries({ queryKey: ['annotations'] })
    void queryClient.invalidateQueries({ queryKey: ['reader-ideas'] })
    void queryClient.invalidateQueries({ queryKey: ['idea-composer'] })
    void queryClient.invalidateQueries({ queryKey: ['reviews'] })
    void queryClient.invalidateQueries({ queryKey: ['note-archive'] })
  }

  async function runPreview(customScope?: ReadingImportScope) {
    setBusy(true)
    setError(null)
    setPreview(null)
    const bookKeys = [...selected]
    const effectiveScope = source === 'weread' && wereadChannel === 'skill' ? 'all' : (customScope ?? scope)
    try {
      const data = source === 'weread'
        ? (await apiPost<{ data: ReadingImportPreview }>('/reading-imports/weread/preview', { channel: wereadChannel, scope: effectiveScope, bookKeys })).data
        : (await apiUpload<{ data: ReadingImportPreview }>(`/reading-imports/legado/preview?scope=${effectiveScope}`, file!)).data
      setPreview(data)
      if (source === 'legado') setSelected(new Set())
      if (source === 'weread') {
        setFetched(new Set(data.items.map((item) => item.bookKey)))
        setList((prev) => prev && {
          ...prev,
          items: prev.items.map((item) => data.items.find((fresh) => fresh.bookKey === item.bookKey) ?? item),
        })
      }
    } catch (err) {
      setError(getUserErrorMessage(err, _, 'readingImport.importFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function handleStartImport() {
    if (selected.size === 0) return
    setBusy(true)
    setError(null)
    const bookKeys = [...selected]
    const effectiveScope = source === 'weread' && wereadChannel === 'skill' ? 'all' : scope
    try {
      let previewId = preview?.previewId
      if (!previewId) {
        if (source === 'weread') {
          const previewData = (
            await apiPost<{ data: ReadingImportPreview }>('/reading-imports/weread/preview', {
              channel: wereadChannel,
              scope: effectiveScope,
              bookKeys,
            })
          ).data
          previewId = previewData.previewId
        } else if (file) {
          const previewData = (
            await apiUpload<{ data: ReadingImportPreview }>(
              `/reading-imports/legado/preview?scope=${effectiveScope}`,
              file,
            )
          ).data
          previewId = previewData.previewId
        }
      }

      if (!previewId) {
        throw new Error('Missing preview')
      }

      const data = source === 'weread'
        ? (await apiPost<{ data: ReadingImportResult }>('/reading-imports/weread/import', { previewId, bookKeys })).data
        : (await apiPost<{ data: ReadingImportResult }>('/reading-imports/legado/import', { previewId, bookKeys })).data
      useToastStore.getState().addToast(_('readingImport.importSuccess', { defaultValue: '已成功导入阅读档案' }), 'success')
      const imported = new Set(bookKeys)
      if (source === 'weread') {
        setList((prev) => prev && {
          ...prev,
          items: prev.items.map((item) => (imported.has(item.bookKey) && item.status !== 'mounted' ? { ...item, status: 'imported' as const } : item)),
        })
      } else {
        setPreview((prev) => prev && {
          ...prev,
          items: prev.items.map((item) => (imported.has(item.bookKey) && item.status !== 'mounted' ? { ...item, status: 'imported' as const } : item)),
        })
      }
      setSelected((prev) => {
        const next = new Set(prev)
        for (const k of bookKeys) next.delete(k)
        return next
      })
      invalidate()
      if (data.conflicts && data.conflicts.length > 0) {
        setConflictNoticeList(data.conflicts)
      }
    } catch (err) {
      setError(getUserErrorMessage(err, _, 'readingImport.importFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function handleSingleBookImport(bookKey: string) {
    setBusy(true)
    setError(null)
    const effectiveScope = source === 'weread' && wereadChannel === 'skill' ? 'all' : scope
    try {
      let previewId = preview?.previewId
      if (!previewId) {
        if (source === 'weread') {
          const previewData = (
            await apiPost<{ data: ReadingImportPreview }>('/reading-imports/weread/preview', {
              channel: wereadChannel,
              scope: effectiveScope,
              bookKeys: [bookKey],
            })
          ).data
          previewId = previewData.previewId
        } else if (file) {
          const previewData = (
            await apiUpload<{ data: ReadingImportPreview }>(
              `/reading-imports/legado/preview?scope=${effectiveScope}`,
              file,
            )
          ).data
          previewId = previewData.previewId
        }
      }

      if (!previewId) {
        throw new Error('Missing preview')
      }

      const data = source === 'weread'
        ? (await apiPost<{ data: ReadingImportResult }>('/reading-imports/weread/import', { previewId, bookKeys: [bookKey] })).data
        : (await apiPost<{ data: ReadingImportResult }>('/reading-imports/legado/import', { previewId, bookKeys: [bookKey] })).data

      useToastStore.getState().addToast(_('readingImport.importSuccess', { defaultValue: '已成功导入阅读档案' }), 'success')
      if (source === 'weread') {
        setList((prev) => prev && {
          ...prev,
          items: prev.items.map((it) =>
            it.bookKey === bookKey && it.status !== 'mounted'
              ? { ...it, status: 'imported' as const }
              : it,
          ),
        })
      } else {
        setPreview((prev) => prev && {
          ...prev,
          items: prev.items.map((it) =>
            it.bookKey === bookKey && it.status !== 'mounted'
              ? { ...it, status: 'imported' as const }
              : it,
          ),
        })
      }
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(bookKey)
        return next
      })
      invalidate()
      if (data.conflicts && data.conflicts.length > 0) {
        setConflictNoticeList(data.conflicts)
      }
    } catch (err) {
      setError(getUserErrorMessage(err, _, 'readingImport.importFailed'))
    } finally {
      setBusy(false)
    }
  }

  const items = useMemo(
    () => (source === 'weread' ? list?.items ?? [] : preview?.items ?? []),
    [source, list, preview],
  )

  const visible = useMemo(() => {
    let listItems = filter === 'all'
      ? items
      : items.filter((item) => filter === 'imported' ? item.status === 'imported' || item.status === 'mounted' : item.status === filter)

    if (bookQuery.trim()) {
      const query = bookQuery.trim().toLowerCase()
      listItems = listItems.filter((item) =>
        item.title.toLowerCase().includes(query) || (item.author && item.author.toLowerCase().includes(query)),
      )
    }
    return listItems
  }, [items, filter, bookQuery])

  const picked = useMemo(() => items.filter((item) => selected.has(item.bookKey)), [items, selected])
  const totals = picked.reduce(
    (acc, item) => ({ notes: acc.notes + item.notes, reviews: acc.reviews + item.reviews, durationFacts: acc.durationFacts + item.durationFacts }),
    { notes: 0, reviews: 0, durationFacts: 0 },
  )
  const selectableVisible = visible.filter((item) => item.selectable)
  const allVisiblePicked = selectableVisible.length > 0 && selectableVisible.every((item) => selected.has(item.bookKey))

  function toggleBook(bookKey: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(bookKey)
      else next.delete(bookKey)
      return next
    })
    if (source === 'weread' && checked && preview && !fetched.has(bookKey)) setPreview(null)
  }

  function toggleVisible(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const item of selectableVisible) {
        if (checked) next.add(item.bookKey)
        else next.delete(item.bookKey)
      }
      return next
    })
    if (source === 'weread' && checked && preview && selectableVisible.some((item) => !fetched.has(item.bookKey))) setPreview(null)
  }

  function handleItemClick(item: (typeof items)[number], event: React.MouseEvent) {
    if (!item.selectable) return
    const isSelected = selected.has(item.bookKey)

    if (event.shiftKey && lastClickedKeyRef.current) {
      const prevIndex = visible.findIndex((it) => it.bookKey === lastClickedKeyRef.current)
      const currIndex = visible.findIndex((it) => it.bookKey === item.bookKey)

      if (prevIndex !== -1 && currIndex !== -1) {
        const [start, end] = prevIndex < currIndex ? [prevIndex, currIndex] : [currIndex, prevIndex]
        const targetKeys = visible
          .slice(start, end + 1)
          .filter((it) => it.selectable)
          .map((it) => it.bookKey)

        setSelected((prev) => {
          const next = new Set(prev)
          for (const k of targetKeys) {
            next.add(k)
          }
          return next
        })
        return
      }
    }

    lastClickedKeyRef.current = item.bookKey
    toggleBook(item.bookKey, !isSelected)
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files?.[0]
    if (droppedFile && droppedFile.name.endsWith('.zip')) {
      setFile(droppedFile)
      resetPreview()
    }
  }

  function handleBackToConfig() {
    listRequest.current++
    setList(null)
    setPreview(null)
    resetPreview()
    setError(null)
    setListError(null)
  }

  const isPreviewPage = items.length > 0
  const isSubpage = isPreviewPage

  const selectedSummary = useMemo(() => {
    if (picked.length === 0) return null
    const parts: string[] = [`已选 ${picked.length} 本`]
    if (scope !== 'time' && totals.notes > 0) parts.push(`笔记 ${totals.notes}`)
    if (scope !== 'time' && totals.reviews > 0) parts.push(`书评 ${totals.reviews}`)
    if (scope !== 'notes' && totals.durationFacts > 0) parts.push(`时长 ${totals.durationFacts}`)
    return parts.join(' · ')
  }, [picked.length, totals.notes, totals.reviews, totals.durationFacts, scope])

  const subpageTitle = isPreviewPage
    ? (source === 'weread'
        ? _('readingImport.titleWeread', { defaultValue: '导入微信读书' })
        : _('readingImport.titleLegado', { defaultValue: '导入 Legado 备份' }))
    : undefined

  const runPreviewRef = useRef(runPreview)
  runPreviewRef.current = runPreview

  const showScopeControl = isPreviewPage && (source === 'legado' || (source === 'weread' && wereadChannel === 'web'))
  const scopeControl = useMemo(() => {
    if (!showScopeControl) return null
    return (
      <div
        role="radiogroup"
        aria-label={_('readingImport.scopeLabel', { defaultValue: '导入范围' })}
        className="inline-flex rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800/80 mr-1.5"
      >
        {SCOPES.map(({ value, labelKey, fallback }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={scope === value}
            onClick={() => {
              if (value === scope) return
              setScope(value)
              setPreview(null)
              if (source === 'legado' && file) {
                void runPreviewRef.current(value)
              }
            }}
            className={cn(
              'cursor-pointer rounded-md px-2 py-0.5 text-xs font-medium transition-all',
              scope === value
                ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
            )}
          >
            {_(labelKey, { defaultValue: fallback })}
          </button>
        ))}
      </div>
    )
  }, [showScopeControl, _, scope, source, file])

  useEffect(() => {
    onSubpageChange?.(
      isSubpage,
      subpageTitle,
      isPreviewPage ? handleBackToConfig : undefined,
      scopeControl,
    )
    return () => {
      onSubpageChange?.(false)
    }
  }, [isSubpage, subpageTitle, isPreviewPage, onSubpageChange, scopeControl])

  const body = (
    <div className={cn('flex flex-col gap-4 text-left', isPreviewPage && 'flex-1 min-h-0')}>
      {/* 页面 1：数据配置（未进入选书预览时展示） */}
      {!isPreviewPage && (
        <>
          {/* 1. 数据来源 */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-stone-900 dark:text-stone-100">
              {_('readingImport.sourceTitle', { defaultValue: '数据来源' })}
            </label>
        <div
          role="tablist"
          aria-label={_('readingImport.sourceLabel', { defaultValue: '数据来源' })}
          className="grid grid-cols-2 gap-2.5"
        >
          {/* 微信读书卡片 */}
          <button
            type="button"
            role="tab"
            aria-label={_('readingImport.sourceWeread', { defaultValue: '微信读书' })}
            aria-selected={source === 'weread'}
            onClick={() => switchSource('weread')}
            className={cn(
              'relative flex items-center gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer',
              source === 'weread'
                ? 'border-stone-800 bg-stone-50/70 shadow-2xs dark:border-stone-300 dark:bg-stone-800/80'
                : 'border-stone-200/90 bg-white hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-stone-700',
            )}
          >
            <img
              src="/metadata-icons/weread.svg"
              alt=""
              width={24}
              height={24}
              loading="lazy"
              decoding="async"
              className="h-6 w-6 shrink-0 rounded-[4px] object-cover"
            />
            <span className="min-w-0 flex-1 text-xs font-semibold text-stone-900 dark:text-stone-50 truncate">
              {_('readingImport.sourceWeread', { defaultValue: '微信读书' })}
            </span>
            {source === 'weread' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-800 dark:text-stone-100">
                <circle cx="12" cy="12" r="10" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            )}
          </button>

          {/* Legado 备份卡片 */}
          <button
            type="button"
            role="tab"
            aria-label={_('readingImport.sourceLegado', { defaultValue: 'Legado 备份' })}
            aria-selected={source === 'legado'}
            onClick={() => switchSource('legado')}
            className={cn(
              'relative flex items-center gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer',
              source === 'legado'
                ? 'border-stone-800 bg-stone-50/70 shadow-2xs dark:border-stone-300 dark:bg-stone-800/80'
                : 'border-stone-200/90 bg-white hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-stone-700',
            )}
          >
            <LegadoIcon className="h-6 w-6 shrink-0 text-[#4478b2] dark:text-[#7eafe9]" />
            <span className="min-w-0 flex-1 text-xs font-semibold text-stone-900 dark:text-stone-50 truncate">
              {_('readingImport.sourceLegado', { defaultValue: 'Legado 备份' })}
            </span>
            {source === 'legado' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-800 dark:text-stone-100">
                <circle cx="12" cy="12" r="10" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* 2. 微信读书：获取方式（放同一行，参考用户需求） */}
      {source === 'weread' && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-stone-700 dark:text-stone-300">
            {_('readingImport.methodLabel', { defaultValue: '获取方式' })}
          </label>
          <div
            role="tablist"
            aria-label={_('readingImport.wereadChannelLabel', { defaultValue: '微信读书导入方式' })}
            className="grid grid-cols-2 gap-2.5"
          >
            {/* API 同步 (Skill) */}
            <button
              type="button"
              role="tab"
              aria-label={_('readingImport.wereadSkill', { defaultValue: 'Skill' })}
              aria-selected={wereadChannel === 'skill'}
              onClick={() => switchWereadChannel('skill')}
              className={cn(
                'relative flex min-h-[76px] flex-col justify-between rounded-xl border p-3 text-left transition-all cursor-pointer',
                wereadChannel === 'skill'
                  ? 'border-stone-800 bg-stone-50/70 shadow-2xs dark:border-stone-300 dark:bg-stone-800/80'
                  : 'border-stone-200/90 bg-white hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-stone-700',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                  {_('readingImport.wereadSkill', { defaultValue: 'Skill' })}
                </p>
                {wereadChannel === 'skill' && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-800 dark:text-stone-100">
                    <circle cx="12" cy="12" r="10" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                )}
              </div>
              <p className={cn(
                'mt-1 text-[11px] leading-snug',
                isSkillNotConfigured
                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                  : 'text-stone-500 dark:text-stone-400',
              )}>
                {isSkillNotConfigured
                  ? _('readingImport.wereadSkillUnconfigured', { defaultValue: '未配置 Key，请前往设置配置' })
                  : _('readingImport.wereadHint', { defaultValue: '使用设置中配置的 Key 同步笔记。' })}
              </p>
            </button>

            {/* 网页导入 */}
            <button
              type="button"
              role="tab"
              aria-label={_('readingImport.wereadWeb', { defaultValue: '网页' })}
              aria-selected={wereadChannel === 'web'}
              onClick={() => switchWereadChannel('web')}
              className={cn(
                'relative flex min-h-[76px] flex-col justify-between rounded-xl border p-3 text-left transition-all cursor-pointer',
                wereadChannel === 'web'
                  ? 'border-stone-800 bg-stone-50/70 shadow-2xs dark:border-stone-300 dark:bg-stone-800/80'
                  : 'border-stone-200/90 bg-white hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-stone-700',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                  {_('readingImport.wereadWeb', { defaultValue: '网页' })}
                </p>
                {wereadChannel === 'web' && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-800 dark:text-stone-100">
                    <circle cx="12" cy="12" r="10" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-stone-500 dark:text-stone-400">
                {_('readingImport.wereadWebHint', { defaultValue: '通过扫码登录可同步阅读时长。' })}
              </p>
            </button>
          </div>

          {/* 网页模式下嵌入登录控制 */}
          {wereadChannel === 'web' && (
            <div className="pt-1">
              <WereadWebLoginControls />
            </div>
          )}
        </div>
      )}

      {/* 3. Legado：上传区域 */}
      {source === 'legado' && (
        <div className="flex flex-col">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); resetPreview() }}
            className="hidden"
          />

          {file ? (
            <div className="flex h-[100px] items-center justify-between rounded-xl border border-stone-200/90 bg-white p-3.5 dark:border-stone-700/80 dark:bg-stone-900/80">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-stone-800 dark:text-stone-200">{file.name}</p>
                  <p className="mt-0.5 text-[11px] text-stone-400 dark:text-stone-500">{formatFileSize(file.size)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFile(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                  resetPreview()
                }}
                aria-label={_('readingImport.removeFile', { defaultValue: '移除文件' })}
                title={_('readingImport.removeFile', { defaultValue: '移除文件' })}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-pointer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex h-[100px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-center transition-colors',
                isDragging
                  ? 'border-stone-500 bg-stone-100 dark:border-stone-400 dark:bg-stone-800'
                  : 'border-stone-300 bg-white hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900/60 dark:hover:bg-stone-900',
              )}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="text-xs font-medium text-stone-700 dark:text-stone-300">
                {_('readingImport.legadoDropHint', { defaultValue: '点击或拖拽 Legado 备份文件 (.zip) 到此处' })}
              </p>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* 页面 2：选书与预览新页（独立全幅空间展示） */}
      {isPreviewPage && (
        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">
          {/* 书单选择列表容器 */}
          <div className="flex flex-col rounded-xl border border-stone-200/90 dark:border-stone-800 flex-1 min-h-0 overflow-hidden">
            {/* 列表头部过滤与搜索栏（单行排布在同一行） */}
            <div className="shrink-0 flex items-center justify-between gap-2 border-b border-stone-200/90 px-3 py-2 dark:border-stone-800">
              <div className="inline-flex shrink-0 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800/80">
                {FILTERS.map(({ value, labelKey, fallback }) => {
                  const count = value === 'all'
                    ? items.length
                    : items.filter((item) => value === 'imported' ? item.status === 'imported' || item.status === 'mounted' : item.status === value).length
                  return (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={filter === value}
                      onClick={() => setFilter(value)}
                      className={cn(
                        'cursor-pointer rounded-md px-2 py-0.5 text-xs font-medium transition-colors outline-none focus-visible:ring-1.5 focus-visible:ring-stone-400',
                        filter === value
                          ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                          : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                      )}
                    >
                      {_(labelKey, { defaultValue: fallback })}
                      <span className="ml-1 text-[11px] tabular-nums opacity-75">{count}</span>
                    </button>
                  )
                })}
              </div>

              {/* 右上角搜索图标按钮与全选 Checkbox */}
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen((prev) => {
                      const next = !prev
                      if (next) {
                        setTimeout(() => searchInputRef.current?.focus(), 50)
                      } else {
                        setBookQuery('')
                      }
                      return next
                    })
                  }}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 cursor-pointer',
                    (searchOpen || bookQuery) && 'bg-stone-200/80 text-stone-900 dark:bg-stone-700 dark:text-stone-100',
                  )}
                  aria-label={_('readingImport.toggleSearch', { defaultValue: '搜索' })}
                  title={_('readingImport.toggleSearch', { defaultValue: '搜索' })}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </button>

                <Checkbox
                  checked={allVisiblePicked}
                  disabled={selectableVisible.length === 0}
                  onChange={(checked) => toggleVisible(checked)}
                  label={<span className="whitespace-nowrap">{_('readingImport.selectAll', { defaultValue: '全选' })}</span>}
                  className="shrink-0 whitespace-nowrap"
                />
              </div>
            </div>

            {/* 展开式搜索框 */}
            {searchOpen && (
              <div className="shrink-0 border-b border-stone-200/90 bg-stone-50/50 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/40">
                <div className="relative flex items-center">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 text-stone-400">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={bookQuery}
                    onChange={(e) => setBookQuery(e.target.value)}
                    placeholder={_('readingImport.searchPlaceholder', { defaultValue: '搜索书名或作者…' })}
                    className="h-7 w-full rounded-lg border border-stone-200 bg-white pl-8 pr-7 text-xs text-stone-800 placeholder-stone-400 focus:border-stone-400 focus:outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder-stone-500"
                  />
                  {bookQuery && (
                    <button
                      type="button"
                      onClick={() => setBookQuery('')}
                      className="absolute right-2 flex h-4 w-4 items-center justify-center rounded-full bg-stone-200 text-stone-500 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600 cursor-pointer"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 书籍列表（严格内部滚动，不撑开弹窗外层） */}
            <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800/60 [scrollbar-gutter:stable] custom-scrollbar">
              {visible.length === 0 && (
                <li className="px-3 py-10 text-center text-xs text-stone-400 dark:text-stone-500">
                  {_('readingImport.noBooks', { defaultValue: '没有符合条件的书' })}
                </li>
              )}
              {visible.map((item) => {
                const isSelected = selected.has(item.bookKey)
                return (
                  <li
                    key={item.bookKey}
                    role="button"
                    tabIndex={item.selectable ? 0 : -1}
                    aria-label={item.title}
                    aria-selected={isSelected}
                    aria-disabled={!item.selectable}
                    onClick={(e) => handleItemClick(item, e)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && item.selectable) {
                        e.preventDefault()
                        toggleBook(item.bookKey, !isSelected)
                      }
                    }}
                    className={cn(
                      'relative flex items-center gap-3 px-3 py-2.5 transition-colors select-none',
                      item.selectable
                        ? 'cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/50'
                        : 'cursor-not-allowed opacity-40',
                      isSelected
                        ? 'bg-stone-100/90 shadow-2xs ring-1.5 ring-inset ring-stone-800 dark:bg-stone-800 dark:ring-stone-200'
                        : 'bg-transparent',
                    )}
                  >
                    {/* 书籍封面缩略图（选中时带有显眼徽标） */}
                    <div className="relative shrink-0">
                      <ImportBookCover coverUrl={item.coverUrl} title={item.title} />
                      {isSelected && (
                        <span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-stone-900 text-white shadow dark:bg-white dark:text-stone-900">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </div>

                    {/* 书名与作者规范布局：顶部基线对齐，固定两行几何高度，书名固定第一行 */}
                    <div className="flex h-11 min-w-0 flex-1 flex-col justify-center py-0.5 text-left">
                      <p className="truncate text-xs font-medium text-stone-900 dark:text-stone-100 leading-snug">
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] leading-snug text-stone-400 dark:text-stone-500 min-h-[15px]">
                        {item.author || '\u00A0'}
                      </p>
                    </div>

                    {/* 右侧操作按钮：统一风格样式，仅文案不同 */}
                    <button
                      type="button"
                      disabled={busy || !item.selectable}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleSingleBookImport(item.bookKey)
                      }}
                      className={cn(
                        'shrink-0 rounded-lg border border-stone-200/90 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 shadow-2xs transition-all hover:bg-stone-50 dark:border-stone-700/80 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700/80 cursor-pointer',
                        (!item.selectable || busy) && 'pointer-events-none opacity-40',
                      )}
                    >
                      {item.status === 'new'
                        ? _('readingImport.actionImport', { defaultValue: '导入' })
                        : _('readingImport.actionUpdate', { defaultValue: '更新' })}
                    </button>
                  </li>
                )
              })}
            </ul>

            {/* 底部已选汇总（仅当有选中项且有非零数据时展示） */}
            {selectedSummary && (
              <div className="shrink-0 flex items-center justify-between border-t border-stone-200/90 px-3 py-2 text-[11px] text-stone-500 dark:border-stone-800 dark:text-stone-400">
                <span>{selectedSummary}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {(error ?? (listError ? getUserErrorMessage(listError, _, 'readingImport.importFailed') : null)) && (
        <p className="shrink-0 rounded-lg bg-red-50/80 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400" role="alert">
          {error ?? getUserErrorMessage(listError, _, 'readingImport.importFailed')}
        </p>
      )}

      {/* 底部通栏主操作按钮 */}
      <div className="shrink-0 pt-1">
        {!isPreviewPage ? (
          /* 配置页底部：点击获取书单/预览 */
          <Button
            size="lg"
            variant="primary"
            disabled={busy || (source === 'legado' && !file) || isSkillNotConfigured || (source === 'weread' && wereadChannel === 'skill' && configQuery.isPending)}
            onClick={() => {
              if (source === 'weread') {
                void loadBookList()
              } else {
                void runPreview()
              }
            }}
            className="w-full justify-center gap-2 py-2.5 text-xs font-semibold cursor-pointer"
          >
            {busy ? (
              <>
                <Spinner size="xs" />
                <span>{_('readingImport.loading', { defaultValue: '读取中…' })}</span>
              </>
            ) : (
              _('readingImport.preview', { defaultValue: '预览' })
            )}
          </Button>
        ) : (
          /* 选书/预览页底部：直接开始导入 */
          <Button
            size="lg"
            variant="primary"
            disabled={busy || picked.length === 0}
            onClick={() => void handleStartImport()}
            className="w-full justify-center gap-2 py-2.5 text-xs font-semibold cursor-pointer"
          >
            {busy ? (
              <>
                <Spinner size="xs" />
                <span>{_('readingImport.importing', { defaultValue: '正在导入…' })}</span>
              </>
            ) : (
              _('readingImport.confirmImport', { defaultValue: '开始导入' })
            )}
          </Button>
        )}
      </div>
    </div>
  )

  const conflictNoticeModal = conflictNoticeList && conflictNoticeList.length > 0 ? (
    <Modal
      title={_('readingImport.conflictsTitle', { defaultValue: '内容冲突' })}
      onClose={() => setConflictNoticeList(null)}
      size="default"
      footer={
        <div className="flex w-full justify-end">
          <Button
            size="sm"
            variant="primary"
            onClick={() => setConflictNoticeList(null)}
            className="cursor-pointer"
          >
            {_('readingImport.confirm', { defaultValue: '确认' })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-left">
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {_('readingImport.conflictsPreservedDesc', {
            defaultValue: '检测到部分笔记与本地已有内容冲突，已为您保留本地记录：',
          })}
        </p>
        <ul className="max-h-64 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
          {conflictNoticeList.map((conflict) => (
            <li
              key={conflict.key}
              className="flex flex-col gap-1 rounded-lg border border-stone-200/80 bg-stone-50/60 p-2.5 text-xs dark:border-stone-800 dark:bg-stone-900/60"
            >
              {conflict.chapter && (
                <span className="truncate text-[11px] text-stone-400 dark:text-stone-500">
                  {conflict.chapter}
                </span>
              )}
              <div className="flex items-start gap-1.5">
                <span className="shrink-0 font-medium text-stone-500 dark:text-stone-400">
                  {_('readingImport.conflictLocal', { defaultValue: '当前：' })}
                </span>
                <span className="text-stone-800 dark:text-stone-200 line-clamp-3">
                  {conflict.localText}
                </span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="shrink-0 font-medium text-stone-500 dark:text-stone-400">
                  {_('readingImport.conflictIncoming', { defaultValue: '导入：' })}
                </span>
                <span className="text-stone-600 dark:text-stone-300 line-clamp-3">
                  {conflict.incomingText}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  ) : null

  if (embedded) {
    return (
      <>
        {body}
        {conflictNoticeModal}
      </>
    )
  }

  const modalTitle = isPreviewPage ? (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleBackToConfig}
        className="-ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 cursor-pointer"
        aria-label={_('readingImport.backToConfig', { defaultValue: '返回配置' })}
        title={_('readingImport.backToConfig', { defaultValue: '返回配置' })}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <span>{subpageTitle ?? _('readingImport.title', { defaultValue: '导入外部阅读数据' })}</span>
    </div>
  ) : _('readingImport.title', { defaultValue: '导入外部阅读数据' })

  return (
    <>
      <Modal title={modalTitle} onClose={onClose} actions={scopeControl}>
        {body}
      </Modal>
      {conflictNoticeModal}
    </>
  )
}
