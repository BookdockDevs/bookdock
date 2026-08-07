import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiGet, apiPatch, apiPut } from '@/api/client'
import { usePrefetchBookReadingStats } from '@/api/hooks/reading-records'
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
import { createSegmentTracker, trackPosition, closeSegment } from './stats/reading-segments'
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
import TimerPill from './components/TimerPill'
import { getLastHighlightStyle } from './components/annotation-colors'
import { setAutoMarkSelectionMode } from './renderers/FoliateReader'
import { ViewSettingsContext } from './view-settings-context'
import { mergeViewSettings, viewSettingsDiffForKey, hasViewSettings } from './lib/view-settings'
import { readingRateOf, RATE_SAMPLE_MIN_INTERVAL_MS } from './lib/progress-model'
import type { PerBookSettingKey, GlobalViewSettings } from './lib/view-settings'
import type { NavTab, ReaderAnnotation } from './types'
import type { BookDetailRes, ReadingProgressRes, ReadingProgressUpdateReq, ViewSettings } from '@bookdock/shared'

export default function Reader() {
  const _ = useTranslation()
  const { id } = useParams({ from: '/books/$id' })
  const queryClient = useQueryClient()
  const [percent, setPercent] = useState(0)
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number } | null>(null)
  const [currentOffset, setCurrentOffset] = useState<number | null>(null)
  const [currentCfi, setCurrentCfi] = useState<string | null>(null)
  const [chapterFraction, setChapterFraction] = useState<number | undefined>(undefined)
  const [_atChapterStart, setAtChapterStart] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Chapter-switch loading indicator (slow cross-chapter navigation)
  const [navPending, setNavPending] = useState(false)
  // Middle click-area tap reveals the top/bottom bars (mobile: no hover);
  // any interaction (page turn, scroll, selection) hides them again
  const [chromePinned, setChromePinned] = useState(false)
  // Footer visibility state machine: the hot strip SUMMONS the footer; the
  // corner zones (wrapping the capsules) can only SUSTAIN it — they stay
  // pointer-inert while hidden, so approaching a capsule from the page never
  // raises the footer and never moves the capsule under the cursor.
  const [footerSummon, setFooterSummon] = useState(false)
  const [cornerDwell, setCornerDwell] = useState(false)
  const footerVisibleRef = useRef(false)
  const footerVisible = chromePinned || footerSummon || (footerVisibleRef.current && cornerDwell)
  useEffect(() => {
    footerVisibleRef.current = footerVisible
  }, [footerVisible])
  const setSelection = useReaderState((s) => s.setSelection)
  const setTocItems = useReaderState((s) => s.setTocItems)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)
  const setCurrentChapter = useReaderState((s) => s.setCurrentChapter)
  const setCurrentChapterIndex = useReaderState((s) => s.setCurrentChapterIndex)
  const addToast = useToastStore((s) => s.addToast)
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
  const autoMarkSelection = useUiStore((s) => s.autoMarkSelection)
  useEffect(() => {
    setAutoMarkSelectionMode(autoMarkSelection)
  }, [autoMarkSelection])
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

  // --- Per-book reading settings (F1 layering) ---------------------------
  const fontSize = useUiStore((s) => s.fontSize)
  const lineHeight = useUiStore((s) => s.lineHeight)
  const pageWidth = useUiStore((s) => s.pageWidth)
  const horizontalPadding = useUiStore((s) => s.horizontalPadding)
  const verticalPadding = useUiStore((s) => s.verticalPadding)
  const pageColumns = useUiStore((s) => s.pageColumns)
  const columnGap = useUiStore((s) => s.columnGap)
  const scrollPageWidth = useUiStore((s) => s.scrollPageWidth)
  const scrollHorizontalPadding = useUiStore((s) => s.scrollHorizontalPadding)
  const scrollVerticalPadding = useUiStore((s) => s.scrollVerticalPadding)
  const pagePageWidth = useUiStore((s) => s.pagePageWidth)
  const pageHorizontalPadding = useUiStore((s) => s.pageHorizontalPadding)
  const pageVerticalPadding = useUiStore((s) => s.pageVerticalPadding)
  const globalSettings: GlobalViewSettings = useMemo(() => ({
    fontSize,
    lineHeight,
    pageWidth,
    horizontalPadding,
    verticalPadding,
    pageColumns,
    columnGap,
    scrollPageWidth,
    scrollHorizontalPadding,
    scrollVerticalPadding,
    pagePageWidth,
    pageHorizontalPadding,
    pageVerticalPadding,
    readingMode,
  }), [
    fontSize, lineHeight, pageWidth, horizontalPadding, verticalPadding, pageColumns, columnGap,
    scrollPageWidth, scrollHorizontalPadding, scrollVerticalPadding,
    pagePageWidth, pageHorizontalPadding, pageVerticalPadding, readingMode,
  ])
  const setFontSize = useUiStore((s) => s.setFontSize)
  const setLineHeight = useUiStore((s) => s.setLineHeight)
  const setPageWidth = useUiStore((s) => s.setPageWidth)
  const setHorizontalPadding = useUiStore((s) => s.setHorizontalPadding)
  const setVerticalPadding = useUiStore((s) => s.setVerticalPadding)
  const setPageColumns = useUiStore((s) => s.setPageColumns)
  const setColumnGap = useUiStore((s) => s.setColumnGap)
  const globalSetterForKey = useCallback(
    (key: PerBookSettingKey, value: number) => {
      switch (key) {
        case 'fontSize': setFontSize(value); break
        case 'lineHeight': setLineHeight(value); break
        case 'pageWidth': setPageWidth(value); break
        case 'horizontalPadding': setHorizontalPadding(value); break
        case 'verticalPadding': setVerticalPadding(value); break
        case 'pageColumns': setPageColumns(value); break
        case 'columnGap': setColumnGap(value); break
      }
    },
    [setFontSize, setLineHeight, setPageWidth, setHorizontalPadding, setVerticalPadding, setPageColumns, setColumnGap],
  )

  // Diff lives in books.meta.viewSettings (server state, fetched by bookQuery).
  const perBook = (bookQuery.data?.data?.meta?.viewSettings as ViewSettings | undefined) ?? undefined
  const effectiveSettings = useMemo(() => mergeViewSettings(globalSettings, perBook), [globalSettings, perBook])

  // Optimistic cache update so the panel and renderer follow immediately;
  // the PATCH itself is debounced and diffs are merged while pending.
  const saveViewSettingsMutation = useMutation({
    mutationFn: (viewSettings: ViewSettings | null) =>
      apiPatch<{ data: BookDetailRes }>(`/books/${id}`, { viewSettings }),
    onMutate: (viewSettings) => {
      queryClient.setQueryData(['book', id], (old: { data: BookDetailRes } | undefined) => {
        if (!old?.data) return old
        const meta = { ...old.data.meta }
        if (viewSettings === null) delete meta.viewSettings
        else meta.viewSettings = { ...((meta.viewSettings as ViewSettings | undefined) ?? {}), ...viewSettings }
        return { ...old, data: { ...old.data, meta } }
      })
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['book', id] })
    },
  })
  const mutateViewSettingsRef = useRef(saveViewSettingsMutation.mutate)
  mutateViewSettingsRef.current = saveViewSettingsMutation.mutate
  const pendingViewSettingsRef = useRef<ViewSettings | null>(null)
  const viewSettingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveViewSettings = useCallback((patch: ViewSettings | null) => {
    if (patch === null) {
      pendingViewSettingsRef.current = null
    } else {
      pendingViewSettingsRef.current = { ...(pendingViewSettingsRef.current ?? {}), ...patch }
    }
    if (viewSettingsTimerRef.current) clearTimeout(viewSettingsTimerRef.current)
    viewSettingsTimerRef.current = setTimeout(() => {
      const payload = pendingViewSettingsRef.current
      pendingViewSettingsRef.current = null
      mutateViewSettingsRef.current(payload)
    }, 400)
  }, [])
  useEffect(() => () => {
    if (viewSettingsTimerRef.current) clearTimeout(viewSettingsTimerRef.current)
  }, [])

  const [perBookActive, setPerBookActiveState] = useState(false)
  // The Reader component persists across /books/:id navigation, so the
  // previous book's per-book state must not leak into the next one
  const activeBookIdRef = useRef<string | null>(null)
  // Set while the user manually turned "仅本书" off but the PATCH clearing the
  // diff is still pending — the diff arriving must not flip the toggle back on
  const suppressAutoEnableRef = useRef(false)
  useEffect(() => {
    if (activeBookIdRef.current !== id) {
      activeBookIdRef.current = id
      suppressAutoEnableRef.current = false
      setPerBookActiveState(hasViewSettings(perBook))
      return
    }
    if (hasViewSettings(perBook)) {
      // diff arrived late (bookQuery) or a change created the first override
      if (!suppressAutoEnableRef.current) setPerBookActiveState(true)
    } else {
      suppressAutoEnableRef.current = false
    }
  }, [id, perBook])
  const perBookActiveRef = useRef(perBookActive)
  perBookActiveRef.current = perBookActive
  const setPerBookActive = useCallback((active: boolean) => {
    setPerBookActiveState(active)
    if (active) {
      suppressAutoEnableRef.current = false
    } else {
      suppressAutoEnableRef.current = true
      saveViewSettings(null)
    }
  }, [saveViewSettings])
  const updateSetting = useCallback((key: PerBookSettingKey, value: number) => {
    if (perBookActiveRef.current) {
      saveViewSettings(viewSettingsDiffForKey(key, value, readingMode))
    } else {
      globalSetterForKey(key, value)
    }
  }, [saveViewSettings, globalSetterForKey, readingMode])
  const viewSettingsContextValue = useMemo(
    () => ({
      effective: effectiveSettings,
      perBookActive,
      setPerBookActive,
      updateSetting,
    }),
    [effectiveSettings, perBookActive, setPerBookActive, updateSetting],
  )

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
  // Reading-speed sampling (P2): a sample is taken only while the reading
  // segment continues (same segmentStart as the previous relocate), throttled
  // to one per minute so short bursts of fast scrolling don't dominate the rate
  const lastSegmentStartRef = useRef<number | null>(null)
  const lastSampleAtRef = useRef(0)

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

  // Gated on bookQuery resolution: the reader mounts only once the success
  // branch's container div exists — mounting earlier grabs the loading-branch
  // div, which React replaces when bookQuery resolves, leaving the view
  // appended to a detached subtree (iframe never loads -> first-open hang).
  const contentUrl = id && bookQuery.data?.data ? `/api/v1/books/${id}/file` : ''

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

  // Count only time after the book has actually rendered; the manual timer
  // mode disables auto recording entirely (sessions belong to the pill)
  const readingTimerMode = useUiStore((s) => s.readingTimerMode)
  const { flush: flushReadingTimer, ping: pingReadingTimer } = useReadingTimer(
    readingTimerMode === 'auto' ? (bookReady ? id : undefined) : undefined,
  )
  // Warm the sidebar stats tab's queries so first open is instant
  usePrefetchBookReadingStats(readingTimerMode === 'off' ? undefined : id)

  // Per-chapter word counts for the info-bar field; must precede useReaderRenderer
  const chapterWordCounts = useMemo(() => {
    const chapters = chaptersQuery.data?.data
    if (!chapters?.length) return undefined
    return chapters.map((c) => (c.wordCount != null
      ? c.wordCount
      : c.endOffset - (c.contentStartOffset ?? c.startOffset)))
  }, [chaptersQuery.data])

  const { containerRef, renderer } = useReaderRenderer({
    url: contentUrl,    // undefined while progress is still loading: the renderer defers mounting
    // so it navigates exactly once (to the saved CFI, or to the book start
    // when progress resolved to none)
    initialCfi: initialCfiRef.current,
    settings: effectiveSettings,
    chapterWordCounts,
    onRendered: () => {
      setBookReady(true)
      setLoadError(null)
    },
    onError: (err) => setLoadError({ message: err.message || '加载失败', kind: 'parse' }),
    onRelocated: (e) => {
      setChromePinned(false)
      setSelection(null)
      pingReadingTimer()
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
      // Manual timer mode owns the read intervals (one interval per manual
      // session) — the auto SegmentTracker must not create its own
      const segmentStartFraction = readingTimerMode === 'auto' && e.fraction !== undefined
        ? trackPosition(segmentTrackerRef.current, e.fraction)
        : undefined
      const now = Date.now()
      const continuous = segmentStartFraction !== undefined
        && segmentStartFraction === lastSegmentStartRef.current
      lastSegmentStartRef.current = segmentStartFraction ?? null
      const sample = continuous && now - lastSampleAtRef.current >= RATE_SAMPLE_MIN_INTERVAL_MS && e.fraction !== undefined
        ? { fraction: e.fraction, at: now }
        : undefined
      if (sample) lastSampleAtRef.current = now
      scheduleProgressSave({ cfi: e.cfi, chapter: e.chapter, percent: e.percent, fraction: e.fraction, segmentStartFraction, sample })
    },
    onSelected: (e) => {
      if (e) setChromePinned(false)
      setSelection(e)
    },
    onAnnotationClicked: (e) => {
      const current = useReaderState.getState().selection
      // A range can hold both a highlight and ideas; the highlight wins the
      // click (same rule as SelectionToolbar), ideas stay reachable from the
      // notes side panel
      const annotation = annotations?.data?.find((a) => a.cfiRange === e.cfiRange && a.type === 'highlight')
        ?? annotations?.data?.find((a) => a.cfiRange === e.cfiRange)
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
    onNavigatePending: ({ pending }) => setNavPending(pending),
    onChromeToggle: () => {
      // Tap-to-toggle: anything visible (pinned bars or the settings popover)
      // dismisses on tap; nothing visible reveals the bars
      if (chromePinned || settingsOpen) {
        setChromePinned(false)
        setSettingsOpen(false)
      } else {
        setChromePinned(true)
      }
    },
    onUserJump: () => closeSegment(segmentTrackerRef.current),
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
      // "选中即划" keeps the toolbar open so the fresh highlight can be restyled
      if (!e.keepSelection) setSelection(null)
    },
  })

  // Byte-weight section boundaries (foliate's own progress model) for the
  // progress strip's drag preview — same model the seek lands by, so the
  // previewed chapter always matches the landing chapter
  const [sectionFractions, setSectionFractions] = useState<number[] | null>(null)
  useEffect(() => {
    setSectionFractions(renderer?.getSectionFractions?.() ?? null)
  }, [renderer])

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
    // chapterCount starts empty; the effect below syncs it when chapters arrive
    segmentTrackerRef.current = createSegmentTracker()
    lastSegmentStartRef.current = null
    lastSampleAtRef.current = 0
    jumpHistoryRef.current.clear()
    syncHistoryCaps()
    historyAutoHideRef.current?.dispose()
    currentCfiRef.current = null
  }, [id, setCurrentChapter, setCurrentChapterIndex, syncHistoryCaps])

  // The displacement threshold scales with the chapter count (big books cap it
  // at two chapter widths); update it once the chapters arrive
  useEffect(() => {
    const count = chaptersQuery.data?.data?.length
    if (count) segmentTrackerRef.current.chapterCount = count
  }, [chaptersQuery.data])

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
    if (!target) { syncHistoryCaps(); historyAutoHideRef.current?.reset(); return }
    // internal: history navigation itself must not re-enter the back stack;
    // showPending: the user did ask for it, so the indicator stays armed
    closeSegment(segmentTrackerRef.current)
    void rendererRef.current?.display(target, { internal: true, showPending: true })
    syncHistoryCaps()
    historyAutoHideRef.current?.reset()
  }, [syncHistoryCaps])

  const onHistoryForward = useCallback(() => {
    const target = jumpHistoryRef.current.forward(currentCfiRef.current ?? '')
    if (!target) { syncHistoryCaps(); historyAutoHideRef.current?.reset(); return }
    closeSegment(segmentTrackerRef.current)
    void rendererRef.current?.display(target, { internal: true, showPending: true })
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

  // Chapter remaining time: measured reading speed when samples exist,
  // otherwise the fixed 800 chars/min assumption.
  const rateSamples = progressQuery.data?.data?.rateSamples
  const rate = useMemo(() => readingRateOf(rateSamples), [rateSamples])
  const totalChars = useMemo(
    () => chapterWordCounts?.reduce((sum, n) => sum + (n ?? 0), 0) ?? 0,
    [chapterWordCounts],
  )
  const estimatedMinutes = useMemo(() => {
    const chapters = chaptersQuery.data?.data
    if (!chapters?.length || currentChapterIndex == null) return undefined
    const current = chapters[currentChapterIndex]
    if (!current) return undefined
    let remainingChars: number | undefined
    if (current.wordCount != null) {
      remainingChars = chapterFraction != null
        ? current.wordCount * (1 - chapterFraction)
        : current.wordCount
    } else if (currentOffset != null && current.endOffset > current.startOffset) {
      // Legacy fallback: offset arithmetic only works for txt chapters
      remainingChars = Math.max(0, current.endOffset - currentOffset)
    }
    if (remainingChars == null) return undefined
    if (rate != null && rate > 0 && totalChars > 0) {
      // measured rate is book-fraction per ms; convert remaining chars to it
      return Math.max(1, Math.ceil((remainingChars / totalChars) / rate / 60_000))
    }
    return Math.max(1, Math.ceil(remainingChars / 800))
  }, [currentChapterIndex, chapterFraction, currentOffset, chaptersQuery.data, rate, totalChars])

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
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        // scroll mode: one screen per key (0.92 viewport overlap, same as the
        // bottom-bar buttons); page mode: PageUp/Down turn pages like the
        // in-iframe handler, plain arrows stay unbound. Handled here so keys
        // keep working after a keyboard chapter switch drops focus to body.
        if (readingMode === 'page' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return
        e.preventDefault()
        const dir = (e.key === 'ArrowDown' || e.key === 'PageDown') ? 1 : -1
        void rendererRef.current?.scrollByPages(dir)
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
      <ViewSettingsContext.Provider value={viewSettingsContextValue}>
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
                pinned={chromePinned}
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
            {navPending && (
              <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                <div className="rounded-full bg-black/10 p-3 shadow-sm backdrop-blur-sm dark:bg-white/10">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin text-[var(--bd-read-sub)]">
                    <path d="M21 12a9 9 0 11-6.219-8.56" />
                  </svg>
                </div>
              </div>
            )}
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
            {/* Bottom chrome: hot strip (carved out around the corners) summons
                the footer; corner zones sustain it and carry the capsules, which
                lift together with the footer via zone translate. Summon handlers
                sit on the strip+footer wrapper so hovering footer controls (own
                pointer targets) still counts as dwelling in the summon region. */}
            <div className="absolute inset-x-0 bottom-0 z-40 pointer-events-none">
              <div
                onPointerEnter={() => setFooterSummon(true)}
                onPointerLeave={() => setFooterSummon(false)}
              >
                <div
                  className={cn(
                    'absolute bottom-0 right-16 h-12 pointer-events-auto',
                    (historyCaps.canBack || historyCaps.canForward) ? 'left-28' : 'left-0',
                  )}
                />
                <ProgressStrip
                  percent={percent}
                  pageInfo={pageInfo ?? undefined}
                  visible={footerVisible}
                  pinned={chromePinned}
                  chapters={chaptersQuery.data?.data}
                  sectionFractions={sectionFractions}
                  onPrevChapter={onPrevChapter}
                  onNextChapter={onNextChapter}
                  onPageUp={onPageUp}
                  onPageDown={onPageDown}
                  onSeek={onSeek}
                />
              </div>
              {(historyCaps.canBack || historyCaps.canForward) && (
                <div
                  className={cn(
                    'absolute bottom-0 left-0 h-24 w-28 transition-transform duration-300',
                    footerVisible ? '-translate-y-10 pointer-events-auto' : 'pointer-events-none',
                  )}
                  onPointerEnter={() => setCornerDwell(true)}
                  onPointerLeave={() => setCornerDwell(false)}
                >
                  <HistoryCapsule
                    canBack={historyCaps.canBack}
                    canForward={historyCaps.canForward}
                    onBack={onHistoryBack}
                    onForward={onHistoryForward}
                  />
                </div>
              )}
              <div
                className={cn(
                  'absolute bottom-0 right-0 h-24 w-16 transition-transform duration-300',
                  footerVisible ? '-translate-y-10 pointer-events-auto' : 'pointer-events-none',
                )}
                onPointerEnter={() => setCornerDwell(true)}
                onPointerLeave={() => setCornerDwell(false)}
              >
                {readingTimerMode === 'manual' && <TimerPill bookId={id} />}
              </div>
            </div>
          </div>
        </div>
        <SelectionToolbar bookId={id} />
      </div>
    </RendererContext.Provider>
    </ViewSettingsContext.Provider>
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
  const statsDisabled = useUiStore((s) => s.readingTimerMode) === 'off'

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
          statsDisabled={statsDisabled}
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
            statsDisabled={statsDisabled}
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
