import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiGet, apiPut } from '@/api/client'
import { t } from '@/i18n'
import { useToastStore } from '@/stores/toast.store'
import { useUiStore, getEffectiveTheme } from '@/stores/ui.store'

import { cn } from '@/lib/utils'
import { isPresetThemeId } from '@/lib/reading-theme'

import { useReaderRenderer } from './hooks/useReaderRenderer'
import { useReaderState } from './state/reader-state'
import { RendererContext } from './hooks/useReaderApi'
import { useBookChapters } from './hooks/useBookChapters'
import { useCreateAnnotation, useAnnotations, useDeleteAnnotation } from './hooks/useAnnotations'
import { ReaderHeader } from './components/ReaderHeader'
import { ToolDock } from './components/ToolDock'
import { NavigationPanel, type NavigationPanelRef } from './components/NavigationPanel'
import { SelectionToolbar } from './components/SelectionToolbar'
import { AnnotationPopup } from './components/AnnotationPopup'
import { ProgressStrip } from './components/ProgressStrip'
import type { BookDetailRes, ReadingProgressRes } from '@bookdock/shared'

export default function Reader() {
  const { id } = useParams({ from: '/books/$id' })
  const queryClient = useQueryClient()
  const [percent, setPercent] = useState(0)
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number } | null>(null)
  const [currentOffset, setCurrentOffset] = useState<number | null>(null)
  const [currentCfi, setCurrentCfi] = useState<string | null>(null)
  const [atChapterStart, setAtChapterStart] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const setSelection = useReaderState((s) => s.setSelection)
  const setAnnotationPopup = useReaderState((s) => s.setAnnotationPopup)
  const setTocItems = useReaderState((s) => s.setTocItems)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const setCurrentChapter = useReaderState((s) => s.setCurrentChapter)
  const setCurrentChapterIndex = useReaderState((s) => s.setCurrentChapterIndex)
  const addToast = useToastStore((s) => s.addToast)
  const showWordCount = useUiStore((s) => s.showWordCount)
  const readingMode = useUiStore((s) => s.readingMode)
  const createAnnotation = useCreateAnnotation(id)
  const deleteAnnotation = useDeleteAnnotation()
  const { data: annotations } = useAnnotations(id)

  const currentBookmark = useMemo(() => {
    if (!currentCfi) return undefined
    return annotations?.data?.find((a) => a.type === 'bookmark' && a.cfiRange === currentCfi)
  }, [annotations?.data, currentCfi])

  const { uiTheme, readingThemeId, lightReadingThemeId, setReadingThemeId } = useUiStore()
  const syncedTheme = useRef(false)
  useEffect(() => {
    if (syncedTheme.current) return
    syncedTheme.current = true
    // only auto-switch presets — never yank a custom theme to 'night'
    if (!isPresetThemeId(readingThemeId)) return
    const effective = getEffectiveTheme(uiTheme)
    if (effective === 'dark') {
      if (readingThemeId !== 'night') setReadingThemeId('night')
    } else {
      if (readingThemeId === 'night') setReadingThemeId(lightReadingThemeId)
    }
  }, [uiTheme, readingThemeId, lightReadingThemeId, setReadingThemeId])

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
    mutationFn: async (body: { cfi?: string; chapter?: string; percent: number }) => {
      const result = await apiPut(`/progress/${id}`, body)
      void queryClient.invalidateQueries({ queryKey: ['progress', id], refetchType: 'none' })
      return result
    },
  })

  const pendingProgress = useRef<{ cfi?: string; chapter?: string; percent: number } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mutateProgressRef = useRef(progressMutation.mutate)
  mutateProgressRef.current = progressMutation.mutate

  const scheduleProgressSave = useCallback(
    (body: { cfi?: string; chapter?: string; percent: number }) => {
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

  const contentUrl = bookQuery.data?.data ? `/api/v1/books/${id}/epub` : ''

  const [bookReady, setBookReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    setBookReady(false)
    setLoadError(null)
  }, [contentUrl])

  // Timeout: if the reader doesn't render within 30s, show error instead of infinite loading
  useEffect(() => {
    if (bookReady || !contentUrl) return
    const timer = setTimeout(() => {
      if (!bookReady) setLoadError('书籍加载超时，请刷新重试')
    }, 30000)
    return () => clearTimeout(timer)
  }, [bookReady, contentUrl])

  const { containerRef, renderer } = useReaderRenderer({
    url: contentUrl,
    initialCfi: progressQuery.data?.data?.cfi ?? undefined,
    onRendered: () => {
      setBookReady(true)
      setLoadError(null)
    },
    onError: (err) => setLoadError(err.message || '加载失败'),
    onRelocated: (e) => {
      setPercent(e.percent)
      setCurrentCfi(e.cfi)
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
      scheduleProgressSave({ cfi: e.cfi, chapter: e.chapter, percent: e.percent })
    },
    onSelected: (e) => setSelection(e),
    onAnnotationClicked: (e) => {
      // clicking the same highlight again closes its card
      const current = useReaderState.getState().annotationPopup
      if (current?.cfiRange === e.cfiRange) setAnnotationPopup(null)
      else setAnnotationPopup({ cfiRange: e.cfiRange, rect: e.rect })
    },
    onTocReady: (items) => setTocItems(items),
  })

  // Push highlight/note annotations into the renderer's overlay layer
  useEffect(() => {
    if (!renderer?.setAnnotations) return
    const list = (annotations?.data ?? [])
      .filter((a) => a.type === 'highlight' || a.type === 'note')
      .map((a) => ({ cfiRange: a.cfiRange, type: a.type as 'highlight' | 'note', color: a.color, style: a.style, note: a.note }))
    renderer.setAnnotations(list)
  }, [renderer, annotations?.data])

  useEffect(() => {
    setCurrentChapter(null)
    setCurrentChapterIndex(null)
  }, [id, setCurrentChapter, setCurrentChapterIndex])

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
    const el = containerRef.current
    if (!el) return
    const handler = () => {
      setSettingsOpen(false)
      setAnnotationPopup(null)
    }
    el.addEventListener('content-click', handler)
    return () => el.removeEventListener('content-click', handler)
  })

  const rendererRef = useRef(renderer)
  useEffect(() => {
    rendererRef.current = renderer
  }, [renderer])

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

  const estimatedMinutes = useMemo(() => {
    if (currentOffset == null || !chaptersQuery.data?.data?.length) return undefined
    const chapters = chaptersQuery.data.data
    const current = chapters.find((c) => currentOffset >= c.startOffset && currentOffset < c.endOffset)
    if (!current) return undefined
    const remaining = Math.max(0, current.endOffset - currentOffset)
    return Math.ceil(remaining / 800)
  }, [currentOffset, chaptersQuery.data])

  const chapterWordCount = useMemo(() => {
    if (!chaptersQuery.data?.data?.length || currentOffset == null) return undefined
    const chapters = chaptersQuery.data.data
    const current = chapters.find((c) => currentOffset >= c.startOffset && currentOffset < c.endOffset)
    if (!current) return undefined
    return current.endOffset - (current.contentStartOffset ?? current.startOffset)
  }, [currentOffset, chaptersQuery.data])

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
        addToast(t().reader.bookmarkRemoved, 'success')
      } catch {
        addToast(t().reader.bookmarkFailed, 'error')
      }
      return
    }
    try {
      const snippet = rendererRef.current?.getSnippet?.(currentCfi, 80)
      await createAnnotation.mutateAsync({
        cfiRange: currentCfi,
        cfiAnchor: currentCfi,
        type: 'bookmark',
        text: snippet?.trim() || currentChapter || t().reader.bookmark,
        chapter: currentChapter ?? undefined,
      })
      addToast(t().reader.bookmarkAdded, 'success')
    } catch {
      addToast(t().reader.bookmarkFailed, 'error')
    }
  }, [currentBookmark, currentChapter, currentCfi, createAnnotation, deleteAnnotation, addToast])

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

  if (bookQuery.isLoading) return <p className="p-6 text-stone-500">{t().reader.loading}</p>
  if (bookQuery.isError) return <p className="p-6 text-red-500">加载失败: {(bookQuery.error as Error)?.message || '未知错误'}</p>
  if (!bookQuery.data?.data) return <p className="p-6 text-stone-500">{t().reader.notFound}</p>

  const book = bookQuery.data.data

  if (book.format === 'txt' && chaptersQuery.isLoading) {
    return <p className="p-6 text-stone-500">{t().reader.loading}</p>
  }

  return (
    <RendererContext.Provider value={{ renderer }}>
      <div className="fixed inset-0 z-30" style={{ backgroundColor: 'var(--bd-read-page-bg)', color: 'var(--bd-read-text)' }}>
        <div className="flex h-full w-full">
          <ReaderSidebar bookId={id} />
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
            <div
              ref={containerRef}
              className={cn(
                'flex-1',
                readingMode === 'page' ? 'overflow-hidden' : 'overflow-y-auto',
              )}
            />
            {!bookReady && (
              <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 text-sm text-[var(--bd-read-sub)]">
                {loadError ? (
                  <>
                    <span className="text-red-500">{loadError}</span>
                    <button
                      className="pointer-events-auto rounded bg-stone-200 px-3 py-1 text-stone-700 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-200 dark:hover:bg-stone-600"
                      onClick={() => window.location.reload()}
                    >
                      刷新
                    </button>
                  </>
                ) : (
                  t().reader.loading
                )}
              </div>
            )}
            {/* Bottom hover zone: hot strip + footer + word count badge share the same group. */}
            <div className="group absolute inset-x-0 bottom-0 z-40 pointer-events-none">
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
          </div>
        </div>
        <SelectionToolbar bookId={id} />
        <AnnotationPopup bookId={id} />
      </div>
    </RendererContext.Provider>
  )
}

const TOOLBAR_LOCKED_KEY = 'bd-reader-toolbar-locked'

function getInitialLocked() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(TOOLBAR_LOCKED_KEY) === 'true'
}

function setLockedStorage(value: boolean) {
  try {
    window.localStorage.setItem(TOOLBAR_LOCKED_KEY, String(value))
  } catch {
    // ignore
  }
}

function ReaderSidebar({ bookId }: { bookId: string }) {
  const activeNavTab = useReaderState((s) => s.activeNavTab)
  const setActiveNavTab = useReaderState((s) => s.setActiveNavTab)
  const sidebarOpen = useReaderState((s) => s.sidebarOpen)
  const setSidebarOpen = useReaderState((s) => s.setSidebarOpen)
  const { readingThemeId, lightReadingThemeId, setReadingThemeId } = useUiStore()

  const [locked, setLocked] = useState(getInitialLocked)
  const [hovered, setHovered] = useState(false)
  const toolbarVisible = locked || hovered || sidebarOpen
  const panelRef = useRef<NavigationPanelRef>(null)

  useEffect(() => {
    setLockedStorage(locked)
  }, [locked])

  function handleNavTab(tab: 'toc' | 'bookmarks' | 'notes' | 'search') {
    if (sidebarOpen && activeNavTab === tab) {
      setSidebarOpen(false)
    } else {
      panelRef.current?.saveScroll()
      setActiveNavTab(tab)
      setSidebarOpen(true)
    }
  }

  function toggleTheme() {
    setReadingThemeId(readingThemeId === 'night' ? lightReadingThemeId : 'night')
  }

  const collapsed = !toolbarVisible

  return (
    <div
      className={cn(
        'relative z-50 flex h-full shrink-0 overflow-hidden transition-all duration-200',
        collapsed ? 'w-2' : sidebarOpen ? 'w-[21.5rem]' : 'w-14',
      )}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          'flex h-full w-14 shrink-0 flex-col items-center border-r py-3 transition-all duration-200',
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
          'h-full shrink-0 overflow-hidden transition-all duration-200',
          sidebarOpen ? 'w-72' : 'w-0',
        )}
        style={{ backgroundColor: 'var(--bd-read-bg)' }}
      >
        <div className="h-full w-72">
          <NavigationPanel
            ref={panelRef}
            bookId={bookId}
            open={sidebarOpen}
            locked={locked}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
      </div>
    </div>
  )
}
