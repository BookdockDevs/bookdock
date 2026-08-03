import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiGet, apiPut } from '@/api/client'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'
import { useUiStore, getEffectiveTheme } from '@/stores/ui.store'

import { cn } from '@/lib/utils'
import { isPresetThemeId } from '@/lib/reading-theme'
import ErrorBoundary from '@/components/ui/ErrorBoundary'

import { useReaderRenderer } from './hooks/useReaderRenderer'
import { useReadingTimer } from './hooks/useReadingTimer'
import { useReaderState } from './state/reader-state'
import { RendererContext } from './hooks/useReaderApi'
import { useBookChapters } from './hooks/useBookChapters'
import { createSegmentTracker, trackPosition } from './stats/reading-segments'
import { createJumpHistory } from './jump-history'
import { createHistoryAutoHide, type HistoryAutoHide } from './history-auto-hide'
import { useCreateAnnotation, useAnnotations, useDeleteAnnotation } from './hooks/useAnnotations'
import { ReaderHeader } from './components/ReaderHeader'
import { Ribbon } from './components/Ribbon'
import { ToolDock } from './components/ToolDock'
import { NavigationPanel, type NavigationPanelRef } from './components/NavigationPanel'
import { SelectionToolbar } from './components/SelectionToolbar'
import { ProgressStrip } from './components/ProgressStrip'
import HistoryCapsule from './components/HistoryCapsule'
import { getLastHighlightStyle } from './components/annotation-colors'
import type { NavTab, ReaderAnnotation } from './types'
import type { BookDetailRes, ReadingProgressRes, ReadingProgressUpdateReq } from '@bookdock/shared'

export default function Reader() {
  const _ = useTranslation()
  const { id } = useParams({ from: '/books/$id' })
  const queryClient = useQueryClient()
  const [percent, setPercent] = useState(0)
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number } | null>(null)
  const [currentOffset, setCurrentOffset] = useState<number | null>(null)
  const [currentCfi, setCurrentCfi] = useState<string | null>(null)
  const [chapterFraction, setChapterFraction] = useState<number | undefined>(undefined)
  const [atChapterStart, setAtChapterStart] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const setSelection = useReaderState((s) => s.setSelection)
  const setTocItems = useReaderState((s) => s.setTocItems)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)
  const setCurrentChapter = useReaderState((s) => s.setCurrentChapter)
  const setCurrentChapterIndex = useReaderState((s) => s.setCurrentChapterIndex)
  const addToast = useToastStore((s) => s.addToast)
  const showWordCount = useUiStore((s) => s.showWordCount)
  const readingMode = useUiStore((s) => s.readingMode)
  const createAnnotation = useCreateAnnotation(id)
  const deleteAnnotation = useDeleteAnnotation(id)
  const { data: annotations } = useAnnotations(id)

  const currentBookmark = useMemo(() => {
    if (!currentCfi) return undefined
    return annotations?.data?.find((a) => a.type === 'bookmark' && a.cfiRange === currentCfi)
  }, [annotations?.data, currentCfi])

  const readingThemeId = useUiStore((s) => s.readingThemeId)
  const lightReadingThemeId = useUiStore((s) => s.lightReadingThemeId)
  const setReadingThemeId = useUiStore((s) => s.setReadingThemeId)
  const syncedTheme = useRef(false)
  useEffect(() => {
    if (syncedTheme.current) return
    syncedTheme.current = true
    // only auto-switch presets — never yank a custom theme to 'night'
    if (!isPresetThemeId(readingThemeId)) return
    if (getEffectiveTheme() === 'dark') {
      if (readingThemeId !== 'night') setReadingThemeId('night')
    } else {
      if (readingThemeId === 'night') setReadingThemeId(lightReadingThemeId)
    }
  }, [readingThemeId, lightReadingThemeId, setReadingThemeId])

  const bookQuery = useQuery({
    queryKey: ['book', id],
    queryFn: () => apiGet<{ data: BookDetailRes }>(`/books/${id}`),
    enabled: !!id,
  })

  const progressQuery = useQuery({
    queryKey: ['progress', id],
    queryFn: () => apiGet<{ data: ReadingProgressRes | null }>(`/progress/${id}`),
    enabled: !!id,
  })

  const progressMutation = useMutation({
    mutationFn: async (body: ReadingProgressUpdateReq) => {
      return apiPut<{ data: ReadingProgressRes | null }>(`/progress/${id}`, body)
    },
    onSuccess: (_result, body) => {
      // The next reader entry latches initialCfi from this cache. If it holds
      // a stale position while the server holds a newer one, the mount saves
      // the stale position back and the background refetch flips the cache —
      // the two positions then alternate on every exit/re-enter. Keep the
      // cache in sync with what we just wrote; invalidate (no refetch) so the
      // next mount still revalidates in the background.
      queryClient.setQueryData(['progress', id], (old: { data: ReadingProgressRes | null } | undefined) =>
        old?.data
          ? {
              data: {
                ...old.data,
                cfi: body.cfi ?? old.data.cfi,
                chapter: body.chapter ?? old.data.chapter,
                percent: body.percent,
                fraction: body.fraction ?? old.data.fraction,
              },
            }
          : old,
      )
      void queryClient.invalidateQueries({ queryKey: ['progress', id], refetchType: 'none' })
    },
  })

  const pendingProgress = useRef<ReadingProgressUpdateReq | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mutateProgressRef = useRef(progressMutation.mutate)
  mutateProgressRef.current = progressMutation.mutate

  const segmentTrackerRef = useRef(createSegmentTracker())

  // Session-only jump history (browser semantics); cleared on book switch below
  const jumpHistoryRef = useRef(createJumpHistory())
  const [historyCaps, setHistoryCaps] = useState({ canBack: false, canForward: false })
  const currentCfiRef = useRef<string | null>(null)
  const syncHistoryCaps = useCallback(() => {
    setHistoryCaps({ canBack: jumpHistoryRef.current.canBack(), canForward: jumpHistoryRef.current.canForward() })
  }, [])
  // Auto-hide drops the stack (and with it the capsule) once the user keeps
  // reading or idles past the change-of-mind window
  const historyAutoHideRef = useRef<HistoryAutoHide | null>(null)
  if (historyAutoHideRef.current === null) {
    historyAutoHideRef.current = createHistoryAutoHide(() => {
      jumpHistoryRef.current.clear()
      syncHistoryCaps()
    })
  }

  const scheduleProgressSave = useCallback(
    (body: ReadingProgressUpdateReq) => {
      pendingProgress.current = body
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        if (pendingProgress.current) {
          mutateProgressRef.current(pendingProgress.current)
          pendingProgress.current = null
        }
      }, 600)
    },
    []
  )

  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (pendingProgress.current) {
        mutateProgressRef.current(pendingProgress.current)
        pendingProgress.current = null
      }
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])

  const chaptersQuery = useBookChapters(id)

  const contentUrl = id ? `/api/v1/books/${id}/file` : ''

  // Latch initialCfi at first resolve: later refetches of ['progress'] (e.g.
  // StatsPanel mounting) must not remount the renderer
  const initialCfiRef = useRef<string | undefined>(undefined)
  const initialCfiBookRef = useRef(id)
  if (initialCfiBookRef.current !== id) {
    initialCfiBookRef.current = id
    initialCfiRef.current = undefined
  }
  if (initialCfiRef.current === undefined && !progressQuery.isPending) {
    initialCfiRef.current = progressQuery.data?.data?.cfi ?? ''
  }

  const [bookReady, setBookReady] = useState(false)
  // kind=timeout: watchdog fired, likely network-related; kind=parse: renderer
  // onError, the file itself failed to load
  const [loadError, setLoadError] = useState<{ message: string; kind: 'timeout' | 'parse' } | null>(null)
  useEffect(() => {
    setBookReady(false)
    setLoadError(null)
  }, [contentUrl])

  // Timeout: if the reader doesn't render within 30s, show error instead of infinite loading
  useEffect(() => {
    if (bookReady || !contentUrl) return
    const timer = setTimeout(() => {
      if (!bookReady) setLoadError({ message: '书籍加载超时', kind: 'timeout' })
    }, 30000)
    return () => clearTimeout(timer)
  }, [bookReady, contentUrl])

  // Count only time after the book has actually rendered
  const { flush: flushReadingTimer } = useReadingTimer(bookReady ? id : undefined)

  const { containerRef, renderer } = useReaderRenderer({
    url: contentUrl,    // undefined while progress is still loading: the renderer defers mounting
    // so it navigates exactly once (to the saved CFI, or to the book start
    // when progress resolved to none)
    initialCfi: initialCfiRef.current,
    onRendered: () => {
      setBookReady(true)
      setLoadError(null)
    },
    onError: (err) => setLoadError({ message: err.message || '加载失败', kind: 'parse' }),
    onRelocated: (e) => {
      setSelection(null)
      setPercent(e.percent)
      setCurrentCfi(e.cfi)
      currentCfiRef.current = e.cfi
      setChapterFraction(e.chapterFraction)
      if (e.page !== undefined && e.total !== undefined) {
        setPageInfo({ page: e.page, total: e.total })
      }
      if (e.chapter) setCurrentChapter(e.chapter)
      if (e.cfi.startsWith('txt:')) {
        const offset = Number(e.cfi.split(':')[1])
        if (!Number.isNaN(offset)) {
          setCurrentOffset(offset)
          // TXT page/percent are book-wide, so detect chapter start by offset distance
          const chapters = chaptersQuery.data?.data
          const chapter = chapters?.find((c) => offset >= c.startOffset && offset < c.endOffset)
          setAtChapterStart(!!chapter && offset - chapter.startOffset < 800)
        }
      } else {
        // foliate emits per-chapter page in both paginated and scrolled flow
        setAtChapterStart((e.pageInChapter ?? 1) <= 1)
        if (e.chapterIndex !== undefined) {
          const chapters = chaptersQuery.data?.data
          if (chapters?.[e.chapterIndex]?.startOffset != null) {
            setCurrentOffset(chapters[e.chapterIndex].startOffset)
          }
        }
      }
      if (e.chapterIndex !== undefined) {
        setCurrentChapterIndex(e.chapterIndex)
      }
      historyAutoHideRef.current?.trackRelocate(e.movedScreens, e.chapterIndex)
      const segmentStartFraction = e.fraction !== undefined
        ? trackPosition(segmentTrackerRef.current, e.fraction)
        : undefined
      scheduleProgressSave({ cfi: e.cfi, chapter: e.chapter, percent: e.percent, fraction: e.fraction, segmentStartFraction })
    },
    onSelected: (e) => setSelection(e),
    onAnnotationClicked: (e) => {
      const current = useReaderState.getState().selection
      const annotation = annotations?.data?.find((a) => a.cfiRange === e.cfiRange)
      if (!annotation || current?.cfiRange === e.cfiRange) { setSelection(null); return }
      setSelection({ cfiRange: e.cfiRange, text: annotation.text, rect: e.rect })
    },
    onTocReady: (items) => setTocItems(items),
    onJumpConfirmed: (e) => {
      if (!e.cfi) return
      jumpHistoryRef.current.push(e.cfi)
      syncHistoryCaps()
      historyAutoHideRef.current?.reset()
    },
    onInstantAnnotation: (e) => {
      const lastStyle = getLastHighlightStyle()
      createAnnotation.mutate({
        cfiRange: e.cfiRange,
        type: 'highlight',
        text: e.text,
        color: lastStyle.color,
        style: lastStyle.style,
        chapter: currentChapter ?? undefined,
      })
      setSelection(null)
    },
  })

  // The loading/error/success branches each render their own container div, so
  // the element identity changes when the book query resolves. Effects that
  // attach listeners to the container must re-run on that swap, hence state.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const containerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
    setContainerEl(el)
  }, [containerRef])

  // Push highlight/note annotations into the renderer's overlay layer
  const noteEditorRange = useReaderState((s) => s.noteEditorRange)
  useEffect(() => {
    if (!renderer?.setAnnotations) return
    const list: ReaderAnnotation[] = (annotations?.data ?? [])
      .filter((a) => a.type === 'highlight' || a.type === 'note')
      .map((a) => ({ cfiRange: a.cfiRange, type: a.type as 'highlight' | 'note', color: a.color, style: a.style, note: a.note }))
    // An idea being composed has no row yet; a pseudo note keeps the dashed
    // underline on its range while the editor is open
    if (noteEditorRange) {
      list.push({ cfiRange: noteEditorRange, type: 'note', color: 'yellow', style: 'underline' })
    }
    renderer.setAnnotations(list)
  }, [renderer, annotations?.data, noteEditorRange])

  useEffect(() => {
    setCurrentChapter(null)
    setCurrentChapterIndex(null)
    segmentTrackerRef.current = createSegmentTracker()
    jumpHistoryRef.current.clear()
    syncHistoryCaps()
    historyAutoHideRef.current?.dispose()
    currentCfiRef.current = null
  }, [id, setCurrentChapter, setCurrentChapterIndex, syncHistoryCaps])

  useEffect(() => () => historyAutoHideRef.current?.dispose(), [])

  useEffect(() => {
    if (progressQuery.data?.data?.chapter) {
      setCurrentChapter(progressQuery.data.data.chapter)
    }
  }, [progressQuery.data, setCurrentChapter])

  useEffect(() => {
    if (!chaptersQuery.data?.data?.length) return
    const cfi = progressQuery.data?.data?.cfi
    if (!cfi?.startsWith('txt:')) return
    const offset = Number(cfi.split(':')[1])
    if (Number.isNaN(offset)) return
    const chapters = chaptersQuery.data.data
    const idx = chapters.findIndex((c) => offset >= c.startOffset && offset < c.endOffset)
    if (idx >= 0) {
      setCurrentChapterIndex(idx)
      setCurrentChapter(chapters[idx].title)
    }
  }, [chaptersQuery.data, progressQuery.data, setCurrentChapter, setCurrentChapterIndex])

  // content-click relayed from the renderer when the reading area is clicked
  useEffect(() => {
    if (!containerEl) return
    const handler = () => {
      setSettingsOpen(false)
      setSelection(null)
    }
    containerEl.addEventListener('content-click', handler)
    return () => containerEl.removeEventListener('content-click', handler)
  }, [containerEl, setSelection])

  // Dismiss popups on scroll (scrolled mode)
  useEffect(() => {
    if (!containerEl) return
    const onScroll = () => {
      setSelection(null)
    }
    containerEl.addEventListener('scroll', onScroll, { passive: true })
    return () => containerEl.removeEventListener('scroll', onScroll)
  }, [containerEl, setSelection])

  const rendererRef = useRef(renderer)
  useEffect(() => {
    rendererRef.current = renderer
  }, [renderer])

  const onHistoryBack = useCallback(() => {
    const target = jumpHistoryRef.current.back(currentCfiRef.current ?? '')
    // internal: history navigation itself must not re-enter the back stack
    if (target) void rendererRef.current?.display(target, { internal: true })
    syncHistoryCaps()
    historyAutoHideRef.current?.reset()
  }, [syncHistoryCaps])

  const onHistoryForward = useCallback(() => {
    const target = jumpHistoryRef.current.forward(currentCfiRef.current ?? '')
    if (target) void rendererRef.current?.display(target, { internal: true })
    syncHistoryCaps()
    historyAutoHideRef.current?.reset()
  }, [syncHistoryCaps])

  // The stored selection rect goes stale when the reading area resizes
  // (sidebar toggle/drag, window resize), so dismiss the bubble instead of
  // leaving it floating at the old position
  useEffect(() => {
    if (!containerEl || typeof ResizeObserver === 'undefined') return
    let width = containerEl.clientWidth
    let height = containerEl.clientHeight
    const ro = new ResizeObserver(() => {
      if (containerEl.clientWidth === width && containerEl.clientHeight === height) return
      width = containerEl.clientWidth
      height = containerEl.clientHeight
      rendererRef.current?.clearSelection()
      setSelection(null)
    })
    ro.observe(containerEl)
    return () => ro.disconnect()
  }, [containerEl, setSelection])

  // Stable context value: a fresh `{ renderer }` object per render would
  // re-render every consumer on each relocate tick, defeating memo below
  const rendererContextValue = useMemo(() => ({ renderer }), [renderer])

  const onPrevChapter = useCallback(() => {
    void rendererRef.current?.prev()
  }, [])

  const onNextChapter = useCallback(() => {
    void rendererRef.current?.next()
  }, [])

  const onSeek = useCallback((value: number) => {
    const renderer = rendererRef.current
    if (renderer?.scrollToPercent) {
      void renderer.scrollToPercent(value)
    } else if (containerRef.current) {
      if (readingMode === 'page') {
        const max = Math.max(1, containerRef.current.scrollWidth - containerRef.current.clientWidth)
        containerRef.current.scrollLeft = Math.round((value / 100) * max)
      } else {
        const max = Math.max(1, containerRef.current.scrollHeight - containerRef.current.clientHeight)
        containerRef.current.scrollTop = Math.round((value / 100) * max)
      }
    }
  }, [containerRef, readingMode])

  const onPageUp = useCallback(() => {
    const renderer = rendererRef.current
    if (renderer?.scrollByPages) {
      void renderer.scrollByPages(-1)
    } else if (containerRef.current) {
      if (readingMode === 'page') {
        containerRef.current.scrollLeft -= containerRef.current.clientWidth
      } else {
        containerRef.current.scrollTop -= containerRef.current.clientHeight
      }
    }
  }, [containerRef, readingMode])

  const onPageDown = useCallback(() => {
    const renderer = rendererRef.current
    if (renderer?.scrollByPages) {
      void renderer.scrollByPages(1)
    } else if (containerRef.current) {
      if (readingMode === 'page') {
        containerRef.current.scrollLeft += containerRef.current.clientWidth
      } else {
        containerRef.current.scrollTop += containerRef.current.clientHeight
      }
    }
  }, [containerRef, readingMode])

  const chapterWordCount = useMemo(() => {
    const chapters = chaptersQuery.data?.data
    if (!chapters?.length || currentChapterIndex == null) return undefined
    const current = chapters[currentChapterIndex]
    if (!current) return undefined
    if (current.wordCount != null) return current.wordCount
    return current.endOffset - (current.contentStartOffset ?? current.startOffset)
  }, [currentChapterIndex, chaptersQuery.data])

  const estimatedMinutes = useMemo(() => {
    const chapters = chaptersQuery.data?.data
    if (!chapters?.length || currentChapterIndex == null) return undefined
    const current = chapters[currentChapterIndex]
    if (!current) return undefined
    if (current.wordCount != null) {
      const remaining = chapterFraction != null
        ? current.wordCount * (1 - chapterFraction)
        : current.wordCount
      return Math.ceil(remaining / 800)
    }
    // Legacy fallback: offset arithmetic only works for txt chapters, whose
    // offsets are real positions; epub offsets are all 0.
    if (currentOffset == null || current.endOffset <= current.startOffset) return undefined
    return Math.ceil(Math.max(0, current.endOffset - currentOffset) / 800)
  }, [currentChapterIndex, chapterFraction, currentOffset, chaptersQuery.data])

  const showWordCountBadge = showWordCount && chapterWordCount != null && atChapterStart

  const onToggleSettings = useCallback(() => {
    setSettingsOpen((v) => !v)
  }, [])

  const onToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen()
    } else {
      void document.exitFullscreen()
    }
  }, [])

  const onAddBookmark = useCallback(async () => {
    if (!currentCfi) return
    if (currentBookmark) {
      try {
        await deleteAnnotation.mutateAsync(currentBookmark.id)
        addToast(_('reader.bookmarkRemoved'), 'success')
      } catch {
        addToast(_('reader.bookmarkFailed'), 'error')
      }
      return
    }
    try {
      const snippet = rendererRef.current?.getSnippet?.(currentCfi, 80)
      await createAnnotation.mutateAsync({
        cfiRange: currentCfi,
        cfiAnchor: currentCfi,
        type: 'bookmark',
        text: snippet?.trim() || currentChapter || _('reader.bookmark'),
        chapter: currentChapter ?? undefined,
      })
      addToast(_('reader.bookmarkAdded'), 'success')
    } catch {
      addToast(_('reader.bookmarkFailed'), 'error')
    }
  }, [currentBookmark, currentChapter, currentCfi, createAnnotation, deleteAnnotation, addToast, _])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (readingMode === 'page' && rendererRef.current?.scrollByPages) {
          void rendererRef.current.scrollByPages(-1)
        } else {
          void rendererRef.current?.prev()
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (readingMode === 'page' && rendererRef.current?.scrollByPages) {
          void rendererRef.current.scrollByPages(1)
        } else {
          void rendererRef.current?.next()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readingMode])

  if (bookQuery.isLoading) {
    return (
      <div className="fixed inset-0 z-30" style={{ backgroundColor: 'var(--bd-read-page-bg)', color: 'var(--bd-read-text)' }}>
        <div ref={containerCallbackRef} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-sm text-[var(--bd-read-sub)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            {_('reader.loading')}
          </div>
        </div>
      </div>
    )
  }

  if (bookQuery.isError) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center" style={{ backgroundColor: 'var(--bd-read-page-bg)', color: 'var(--bd-read-text)' }}>
        <div ref={containerCallbackRef} />
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="font-medium text-red-500">加载失败: {(bookQuery.error as Error)?.message || '未知错误'}</span>
      </div>
    )
  }

  if (!bookQuery.data?.data) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center" style={{ backgroundColor: 'var(--bd-read-page-bg)', color: 'var(--bd-read-text)' }}>
        <div ref={containerCallbackRef} />
        <span className="text-sm text-[var(--bd-read-sub)]">{_('reader.notFound')}</span>
      </div>
    )
  }

  const book = bookQuery.data.data

  return (
    <ErrorBoundary>
      <RendererContext.Provider value={rendererContextValue}>
      <div className="fixed inset-0 z-30" style={{ backgroundColor: 'var(--bd-read-page-bg)', color: 'var(--bd-read-text)' }}>
        <div className="flex h-full w-full">
          <ReaderSidebar bookId={id} onStatsTabOpen={flushReadingTimer} />
          <div className="relative flex flex-1 flex-col">
            {/* Top hover zone: hot strip + header belong to the same group so hover is continuous. */}
            <div className="group absolute inset-x-0 top-0 z-40 pointer-events-none">
              <div className="absolute inset-x-0 top-0 h-12 pointer-events-auto" />
              <ReaderHeader
                title={currentChapter || book.title}
                visible
                settingsOpen={settingsOpen}
                estimatedMinutes={estimatedMinutes}
                onAddBookmark={onAddBookmark}
                onToggleSettings={onToggleSettings}
                onToggleFullscreen={onToggleFullscreen}
                bookmarkActive={!!currentBookmark}
              />
            </div>
            <Ribbon visible={!!currentBookmark} />
            <div
              ref={containerCallbackRef}
              className={cn(
                'flex-1',
                readingMode === 'page' ? 'overflow-hidden' : 'overflow-y-auto',
              )}
            />
            {!bookReady && (
              <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 text-sm text-[var(--bd-read-sub)]">
                {loadError ? (
                  <>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span className="font-medium text-red-500">{loadError.message}</span>
                    <p className="max-w-xs text-center text-xs text-[var(--bd-read-sub)]">
                      {loadError.kind === 'timeout'
                        ? '加载可能受网络影响，请检查网络连接后刷新重试'
                        : '该文件可能格式不支持或已损坏，请确认文件完整性后重新上传'}
                    </p>
                    <div className="pointer-events-auto mt-2 flex gap-3">
                      <Link to="/">
                        <button className="rounded-lg border border-stone-300 bg-white px-4 py-1.5 text-xs font-medium text-stone-700 shadow-sm hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700">
                          返回书库
                        </button>
                      </Link>
                      {loadError.kind === 'parse' && (
                        <Link to="/">
                          <button className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700">
                            重新上传
                          </button>
                        </Link>
                      )}
                      <button
                        className="rounded-lg border border-stone-300 bg-white px-4 py-1.5 text-xs font-medium text-stone-700 shadow-sm hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                        onClick={() => window.location.reload()}
                      >
                        刷新
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin text-[var(--bd-read-sub)]">
                      <path d="M21 12a9 9 0 11-6.219-8.56" />
                    </svg>
                    {_('reader.loading')}
                  </div>
                )}
              </div>
            )}
            {/* Bottom hover zone: hot strip + footer + word count badge share the same group. */}
            <div className="group peer/strip absolute inset-x-0 bottom-0 z-40 pointer-events-none">
              <div className="absolute inset-x-0 bottom-0 h-12 pointer-events-auto" />
              {showWordCountBadge && (
                <div className="pointer-events-none absolute right-4 z-30 text-xs tabular-nums text-[var(--bd-read-sub)] transition-all duration-300 bottom-3 group-hover:bottom-[3.25rem]">
                  {chapterWordCount} 字
                </div>
              )}
              <ProgressStrip
                percent={percent}
                pageInfo={pageInfo ?? undefined}
                visible
                onPrevChapter={onPrevChapter}
                onNextChapter={onNextChapter}
                onPageUp={onPageUp}
                onPageDown={onPageDown}
                onSeek={onSeek}
              />
            </div>
            <HistoryCapsule
              canBack={historyCaps.canBack}
              canForward={historyCaps.canForward}
              onBack={onHistoryBack}
              onForward={onHistoryForward}
            />
          </div>
        </div>
        <SelectionToolbar bookId={id} />
      </div>
    </RendererContext.Provider>
    </ErrorBoundary>
  )
}

const ReaderSidebar = memo(function ReaderSidebar({ bookId, onStatsTabOpen }: { bookId: string; onStatsTabOpen: () => void }) {
  const activeNavTab = useReaderState((s) => s.activeNavTab)
  const setActiveNavTab = useReaderState((s) => s.setActiveNavTab)
  const sidebarOpen = useReaderState((s) => s.sidebarOpen)
  const setSidebarOpen = useReaderState((s) => s.setSidebarOpen)
  const readingThemeId = useUiStore((s) => s.readingThemeId)
  const lightReadingThemeId = useUiStore((s) => s.lightReadingThemeId)
  const setReadingThemeId = useUiStore((s) => s.setReadingThemeId)
  const toolbarLocked = useUiStore((s) => s.toolbarLocked)
  const setToolbarLocked = useUiStore((s) => s.setToolbarLocked)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)

  const SIDEBAR_MIN = 200
  const SIDEBAR_MAX = 500

  const [locked, setLocked] = useState(toolbarLocked)
  const [hovered, setHovered] = useState(false)
  const toolbarVisible = locked || hovered || sidebarOpen
  const panelRef = useRef<NavigationPanelRef>(null)

  const [panelWidth, setPanelWidth] = useState(sidebarWidth)
  const [resizing, setResizing] = useState(false)
  const resizingRef = useRef(false)
  const panelRefWidth = useRef(panelWidth)
  const panelContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLocked(toolbarLocked)
  }, [toolbarLocked])

  useEffect(() => {
    setToolbarLocked(locked)
  }, [locked, setToolbarLocked])

  useEffect(() => {
    if (resizing) return
    setSidebarWidth(panelWidth)
  }, [panelWidth, resizing, setSidebarWidth])

  // Settle the unreported reading segment so the stats tab shows fresh numbers
  const statsTabActive = sidebarOpen && activeNavTab === 'stats'
  useEffect(() => {
    if (statsTabActive) onStatsTabOpen()
  }, [statsTabActive, onStatsTabOpen])

  const dragState = useRef({ clientX: 0, width: 0 })

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    resizingRef.current = true
    dragState.current.width = panelContainerRef.current?.getBoundingClientRect().width ?? panelWidth
    dragState.current.clientX = e.clientX
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [panelWidth])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizingRef.current) return
    const delta = e.clientX - dragState.current.clientX
    const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragState.current.width + delta))
    setPanelWidth(next)
    panelRefWidth.current = next
  }, [])

  const handlePointerUp = useCallback(() => {
    if (!resizingRef.current) return
    resizingRef.current = false
    setResizing(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setSidebarWidth(panelRefWidth.current)
  }, [setSidebarWidth])

  const handleNavTab = useCallback((tab: NavTab) => {
    if (sidebarOpen && activeNavTab === tab) {
      setSidebarOpen(false)
    } else {
      panelRef.current?.saveScroll()
      setActiveNavTab(tab)
      setSidebarOpen(true)
    }
  }, [sidebarOpen, activeNavTab, setActiveNavTab, setSidebarOpen])

  const handleClosePanel = useCallback(() => {
    setSidebarOpen(false)
  }, [setSidebarOpen])

  function toggleTheme() {
    setReadingThemeId(readingThemeId === 'night' ? lightReadingThemeId : 'night')
  }

  const collapsed = !toolbarVisible

  const totalWidth = collapsed
    ? 8
    : sidebarOpen
      ? 56 + panelWidth
      : 56

  return (
    <div
      className={cn(
        'relative z-50 flex h-full shrink-0 overflow-hidden',
        !resizing && 'transition-all duration-200',
      )}
      style={{ width: totalWidth }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          'flex h-full w-14 shrink-0 flex-col items-center border-r py-3',
          !resizing && 'transition-all duration-200',
          collapsed ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100',
        )}
        style={{ backgroundColor: 'var(--bd-read-bg)', borderColor: 'var(--bd-read-accent)' }}
      >
        <ToolDock
          activeNavTab={activeNavTab}
          sidebarOpen={sidebarOpen}
          locked={locked}
          onNavTab={handleNavTab}
          onToggleLock={() => setLocked(!locked)}
        />
        <div className="flex-1" />
        <button
          onClick={toggleTheme}
          title={readingThemeId === 'night' ? '切换为日间' : '切换为夜间'}
          className="flex h-10 w-10 items-center justify-center rounded-lg border text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10"
          style={{ borderColor: 'var(--bd-read-accent)' }}
        >
          {readingThemeId === 'night' ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
          )}
        </button>
      </div>
      <div
        className={cn(
          'relative h-full shrink-0 overflow-hidden',
          !resizing && 'transition-all duration-200',
        )}
        style={{ width: sidebarOpen ? panelWidth : 0, backgroundColor: 'var(--bd-read-bg)' }}
      >
        <div className="h-full" style={{ width: panelWidth }}>
          <NavigationPanel
            ref={panelRef}
            bookId={bookId}
            open={sidebarOpen}
            locked={locked}
            onClose={handleClosePanel}
          />
        </div>
        {sidebarOpen && (
          <div
            className="absolute right-0 top-0 z-50 h-full w-1 cursor-col-resize hover:w-1.5 hover:bg-blue-500/40 active:w-1.5 active:bg-blue-500/60"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        )}
      </div>
    </div>
  )
})
