import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiGet, apiPatch, apiPut } from '@/api/client'
import { usePrefetchBookReadingStats } from '@/api/hooks/reading-records'
import { useBookTransforms } from '@/api/hooks/useTransforms'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'
import { useUiStore, getEffectiveTheme } from '@/stores/ui.store'

import { cn } from '@/lib/utils'
import { isPresetThemeId } from '@/lib/reading-theme'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import Modal from '@/components/ui/Modal'

import { useReaderRenderer } from './hooks/useReaderRenderer'
import { useReadingTimer } from './hooks/useReadingTimer'
import { useIsTouch } from './hooks/useIsTouch'
import { useReaderState } from './state/reader-state'
import { RendererContext } from './hooks/useReaderApi'
import { TtsSessionProvider } from './hooks/TtsSessionProvider'
import { useBookChapters } from './hooks/useBookChapters'
import { createSegmentTracker, trackPosition, closeSegment } from './stats/reading-segments'
import { createJumpHistory } from './jump-history'
import { createHistoryAutoHide, type HistoryAutoHide } from './history-auto-hide'
import { consumeEscFlag } from './lib/esc-consumed'
import { useCreateAnnotation, useAnnotations, useDeleteAnnotation } from './hooks/useAnnotations'
import { ReaderHeader } from './components/ReaderHeader'
import { ReaderSidebar } from './components/ReaderSidebar'
import { Ribbon } from './components/Ribbon'
import { SelectionToolbar } from './components/SelectionToolbar'
import ShareCardDialog from './components/share/ShareCardDialog'
import { ProgressStrip } from './components/ProgressStrip'
import HistoryCapsule from './components/HistoryCapsule'
import ReaderFooterControls from './components/ReaderFooterControls'
import { getLastHighlightStyle } from './components/annotation-colors'
import { setActiveTransforms, setAutoMarkSelectionMode } from './renderers/FoliateReader'
import TransformForm from '../settings/components/TransformForm'
import { ViewSettingsContext } from './view-settings-context'
import { mergeViewSettings, viewSettingsDiffForKey, hasViewSettings } from './lib/view-settings'
import { readingRateOf, RATE_SAMPLE_MIN_INTERVAL_MS } from './lib/progress-model'
import type { PerBookSettingKey, GlobalViewSettings } from './lib/view-settings'
import type { FootnoteEntry, ReaderAnnotation } from './types'
import { FootnotePopup } from './components/FootnotePopup'
import type { BookDetailRes, ReadingProgressRes, ReadingProgressUpdateReq, ViewSettings } from '@bookdock/shared'

export default function Reader() {
  const _ = useTranslation()
  const { id } = useParams({ from: '/books/$id' })
  const deepLinkParams = new URLSearchParams(window.location.search)
  const deepLinkAnnotation = deepLinkParams.get('annotation')
  const deepLinkCfi = deepLinkParams.get('cfi')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [percent, setPercent] = useState(0)
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number } | null>(null)
  const [currentCfi, setCurrentCfi] = useState<string | null>(null)
  const [chapterFraction, setChapterFraction] = useState<number | undefined>(undefined)
  const [_atChapterStart, setAtChapterStart] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ttsOpen, setTtsOpen] = useState(false)
  const [footnoteEntry, setFootnoteEntry] = useState<FootnoteEntry | null>(null)
  // Chapter-switch loading indicator (slow cross-chapter navigation)
  const [navPending, setNavPending] = useState(false)
  // Middle click-area tap reveals the top/bottom bars (mobile: no hover);
  // reading-area interactions hide them again, while footer controls keep them open for consecutive navigation
  const [chromePinned, setChromePinned] = useState(false)
  const keepChromePinnedRef = useRef(false)
  // Footer visibility state machine: the hot strip SUMMONS the footer; the
  // corner zones (wrapping the capsules) can only SUSTAIN it — they stay
  // pointer-inert while hidden, so approaching a capsule from the page never
  // raises the footer and never moves the capsule under the cursor.
  const [footerSummon, setFooterSummon] = useState(false)
  const [cornerDwell, setCornerDwell] = useState(false)
  // Touch devices have no hover: the chrome hot zones stay inert and the
  // top/bottom controls are driven by the middle-tap chromePinned alone.
  const isTouch = useIsTouch()
  const footerVisibleRef = useRef(false)
  const footerVisible = chromePinned || footerSummon || (footerVisibleRef.current && cornerDwell)
  useEffect(() => {
    footerVisibleRef.current = footerVisible
  }, [footerVisible])
  const setSelection = useReaderState((s) => s.setSelection)
  const setAiContext = useReaderState((s) => s.setAiContext)
  const setAiPendingCommand = useReaderState((s) => s.setAiPendingCommand)
  const replaceTarget = useReaderState((s) => s.replaceTarget)
  const setReplaceTarget = useReaderState((s) => s.setReplaceTarget)
  const setTocItems = useReaderState((s) => s.setTocItems)
  const sidebarOpen = useReaderState((s) => s.sidebarOpen)
  const mobileDockVisible = isTouch && (chromePinned || sidebarOpen)
  const setSidebarOpen = useReaderState((s) => s.setSidebarOpen)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)
  const setCurrentChapter = useReaderState((s) => s.setCurrentChapter)
  const setCurrentChapterIndex = useReaderState((s) => s.setCurrentChapterIndex)
  const addToast = useToastStore((s) => s.addToast)
  const readingMode = useUiStore((s) => s.readingMode)
  const toolbarLocked = useUiStore((s) => s.toolbarLocked)
  const createAnnotation = useCreateAnnotation(id)
  const deleteAnnotation = useDeleteAnnotation(id)
  const { data: annotations } = useAnnotations(id)
  const deepLinkHandled = useRef(false)

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
  usePageTitle(bookQuery.data?.data?.title ?? _('reader.loading'))

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

  // --- Per-book preset binding (book.meta.boundPresetId) -------------------
  // Same optimistic-cache pattern as the viewSettings mutation above.
  const boundPresetId = (bookQuery.data?.data?.meta?.boundPresetId as string | undefined) ?? null
  const bindPresetMutation = useMutation({
    mutationFn: (presetId: string | null) =>
      apiPatch<{ data: BookDetailRes }>(`/books/${id}`, { boundPresetId: presetId }),
    onMutate: (presetId) => {
      queryClient.setQueryData(['book', id], (old: { data: BookDetailRes } | undefined) => {
        if (!old?.data) return old
        const meta = { ...old.data.meta }
        if (presetId === null) delete meta.boundPresetId
        else meta.boundPresetId = presetId
        return { ...old, data: { ...old.data, meta } }
      })
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['book', id] })
    },
  })
  const setBoundPreset = useCallback((presetId: string | null) => {
    bindPresetMutation.mutate(presetId)
  }, [bindPresetMutation])

  // Binding resolution: the open book's bound preset heads the resolution
  // chain (bound > device active > global); leaving or switching books falls
  // back to the device chain. The store writes only on actual change, so
  // this never loops with the routing fold.
  const setBoundPresetId = useUiStore((s) => s.setBoundPresetId)
  const applyReadingResolution = useUiStore((s) => s.applyReadingResolution)
  useEffect(() => {
    setBoundPresetId(boundPresetId)
    applyReadingResolution()
    return () => {
      setBoundPresetId(null)
      applyReadingResolution()
    }
  }, [boundPresetId, setBoundPresetId, applyReadingResolution])

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
      perBookDiff: perBook,
      boundPresetId,
      setBoundPreset,
    }),
    [effectiveSettings, perBookActive, setPerBookActive, updateSetting, perBook, boundPresetId, setBoundPreset],
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
                chapterIndex: body.chapterIndex ?? old.data.chapterIndex,
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
  const initialFractionRef = useRef<number | undefined>(undefined)
  const initialCfiBookRef = useRef(id)
  if (initialCfiBookRef.current !== id) {
    initialCfiBookRef.current = id
    initialCfiRef.current = undefined
    initialFractionRef.current = undefined
  }
  if (initialCfiRef.current === undefined && !progressQuery.isPending) {
    const data = progressQuery.data?.data
    initialCfiRef.current = data?.cfi ?? ''
    // After re-TOC the saved CFI is stale; restore by the book-level percent
    // instead (content is unchanged, so the fraction still lands on the same
    // text). The reader re-saves a fresh CFI on the first relocate.
    initialFractionRef.current = data?.cfi ? undefined : data && data.percent > 0 ? data.percent / 100 : undefined
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

  // Text transforms (正文变换 P1): the module-level rule set must be populated
  // before the renderer mounts (transforms apply at section load time), so
  // this effect is declared before useReaderRenderer. Cleared on unmount and
  // book switch so rules never leak into another book's reader.
  const { data: transformsData } = useBookTransforms(id)
  const transformRules = useMemo(() => transformsData?.data ?? [], [transformsData])
  useEffect(() => {
    setActiveTransforms(transformRules)
    return () => setActiveTransforms([])
  }, [transformRules])

  // A stale replace dialog must not follow the reader into another book
  useEffect(() => {
    setReplaceTarget(null)
    deepLinkHandled.current = false
  }, [id, setReplaceTarget])

  const { containerRef, renderer, fontStack, fontCss } = useReaderRenderer({
    url: contentUrl,    // undefined while progress is still loading: the renderer defers mounting
    bookId: id,
    // so it navigates exactly once (to the saved CFI, or to the book start
    // when progress resolved to none)
    initialCfi: initialCfiRef.current,
    initialFraction: initialFractionRef.current,
    settings: effectiveSettings,
    chapterWordCounts,
    onRendered: () => {
      setBookReady(true)
      setLoadError(null)
    },
    onError: (err) => setLoadError({ message: err.message || '加载失败', kind: 'parse' }),
    onFootnoteOpen: (entry) => {
      setSelection(null)
      setSettingsOpen(false)
      setFootnoteEntry(entry)
    },
    onFootnoteClose: () => setFootnoteEntry(null),
    onRelocated: (e) => {
      if (e.source !== 'tts' && !keepChromePinnedRef.current) setChromePinned(false)
      setSelection(null)
      if (e.source !== 'tts') pingReadingTimer()
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
          // TXT page/percent are book-wide, so detect chapter start by offset distance
          const chapters = chaptersQuery.data?.data
          const chapter = chapters?.find((c) => offset >= c.startOffset && offset < c.endOffset)
          setAtChapterStart(!!chapter && offset - chapter.startOffset < 800)
        }
      } else {
        // foliate emits per-chapter page in both paginated and scrolled flow
        setAtChapterStart((e.pageInChapter ?? 1) <= 1)
      }
      if (e.chapterIndex !== undefined) {
        setCurrentChapterIndex(e.chapterIndex)
      }
      historyAutoHideRef.current?.trackRelocate(e.movedScreens, e.chapterIndex)
      // TTS maintains its own position and must not overwrite the user's
      // reading progress while it moves the renderer internally.
      if (e.source === 'tts') return
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
      scheduleProgressSave({ cfi: e.cfi, chapter: e.chapter, ...(e.chapterIndex === undefined ? {} : { chapterIndex: e.chapterIndex }), percent: e.percent, fraction: e.fraction, segmentStartFraction, sample })
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
      if (isTouch) {
        keepChromePinnedRef.current = true
        setChromePinned(true)
      }
    },
    onNavigatePending: ({ pending }) => setNavPending(pending),
    onChromeToggle: () => {
      keepChromePinnedRef.current = false
      // Tap-to-toggle: anything visible (pinned bars, the settings popover,
      // or a dismissible sidebar) closes on tap. A locked desktop sidebar is
      // persistent and must not participate in reading-chrome dismissal.
      const dismissibleSidebarOpen = sidebarOpen && (isTouch || !toolbarLocked)
      if (chromePinned || settingsOpen || dismissibleSidebarOpen) {
        setChromePinned(false)
        setSettingsOpen(false)
        if (dismissibleSidebarOpen) setSidebarOpen(false)
      } else {
        setChromePinned(true)
      }
    },
    onUserJump: () => closeSegment(segmentTrackerRef.current),
    onTransformInvalid: (e) => {
      // The same invalid patch is reported again on every section reload —
      // toast only the freshly discovered ones
      const known = useReaderState.getState().invalidTransformIds
      const fresh = e.ids.filter((id) => !known.includes(id))
      if (fresh.length) {
        addToast(_('reader.transformsInvalidToast', { count: fresh.length }), 'error')
      }
      useReaderState.getState().addInvalidTransformIds(e.ids)
    },
    onAnnotationOrphaned: (e) => {
      useReaderState.getState().addOrphanedAnnotationKeys([`${e.cfiRange}|${e.type}`])
    },
    onInstantAnnotation: (e) => {
      const lastStyle = getLastHighlightStyle()
      createAnnotation.mutate({
        cfiRange: e.cfiRange,
        type: 'highlight',
        // Same rawText preference as the toolbar — see SelectionToolbar.highlight
        text: (e.rawText ?? e.text).slice(0, 500),
        color: lastStyle.color,
        style: lastStyle.style,
        chapter: currentChapter ?? undefined,
      })
      // "选中即划" keeps the toolbar open so the fresh highlight can be restyled
      if (!e.keepSelection) setSelection(null)
    },
  })

  useEffect(() => {
    if (deepLinkHandled.current || !bookReady || !renderer) return
    const annotation = deepLinkAnnotation
      ? annotations?.data?.find((item) => item.id === deepLinkAnnotation)
      : undefined
    const target = deepLinkCfi || annotation?.cfiAnchor || annotation?.cfiRange
    if (!target) return
    deepLinkHandled.current = true
    void renderer.display(target)
  }, [annotations?.data, bookReady, deepLinkAnnotation, deepLinkCfi, renderer])

  // Rule-set changes after mount must invalidate the cached sections: the
  // renderer tears the view down and reopens it (same mechanism as the
  // Chinese-conversion switch). No-op while the query is still loading.
  useEffect(() => {
    if (!renderer || transformsData === undefined) return
    void renderer.applyTextTransforms(transformRules)
  }, [renderer, transformRules, transformsData])

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
    setAiContext(null)
    setAiPendingCommand(null)
    // chapterCount starts empty; the effect below syncs it when chapters arrive
    segmentTrackerRef.current = createSegmentTracker()
    lastSegmentStartRef.current = null
    lastSampleAtRef.current = 0
    jumpHistoryRef.current.clear()
    syncHistoryCaps()
    historyAutoHideRef.current?.dispose()
    currentCfiRef.current = null
  }, [id, setAiContext, setAiPendingCommand, setCurrentChapter, setCurrentChapterIndex, syncHistoryCaps])

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
      setTtsOpen(false)
      setSelection(null)
    }
    containerEl.addEventListener('content-click', handler)
    return () => containerEl.removeEventListener('content-click', handler)
  }, [containerEl, setSelection])

  // While a floating UI is open (selection bubble / note editor / settings
  // popover), the click that dismisses it must not also turn a page or toggle
  // chrome — the renderer swallows click-to-turn while the guard is held
  const selection = useReaderState((s) => s.selection)
  const popupOpen = !!selection || settingsOpen || ttsOpen || !!footnoteEntry
  useEffect(() => {
    if (!popupOpen || !renderer) return
    renderer.pushPopupGuard()
    return () => renderer.popPopupGuard()
  }, [popupOpen, renderer])

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
    keepChromePinnedRef.current = true
    void rendererRef.current?.prev()
  }, [])

  const onNextChapter = useCallback(() => {
    keepChromePinnedRef.current = true
    void rendererRef.current?.next()
  }, [])

  const onSeek = useCallback((value: number) => {
    keepChromePinnedRef.current = true
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
    keepChromePinnedRef.current = true
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
    keepChromePinnedRef.current = true
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
    }
    if (remainingChars == null) return undefined
    if (rate != null && rate > 0 && totalChars > 0) {
      // measured rate is book-fraction per ms; convert remaining chars to it
      return Math.max(1, Math.ceil((remainingChars / totalChars) / rate / 60_000))
    }
    return Math.max(1, Math.ceil(remainingChars / 800))
  }, [currentChapterIndex, chapterFraction, chaptersQuery.data, rate, totalChars])

  const onToggleSettings = useCallback(() => {
    if (!toolbarLocked) setSidebarOpen(false)
    setTtsOpen(false)
    setSettingsOpen((v) => !v)
  }, [setSidebarOpen, toolbarLocked])

  const onToggleTts = useCallback(() => {
    setSettingsOpen(false)
    setTtsOpen((v) => !v)
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
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // A focused input's own Esc handler (or a window-level popup handler)
        // marks the consumed flag synchronously. Consume it in the next tick so
        // a stale mark cannot swallow the boss key on the following press.
        if (e.key === 'Escape') {
          setTimeout(() => {
            consumeEscFlag()
          }, 0)
        }
        return
      }
      if (e.key === 'Escape') {
        // Boss key: popups mark the consumed flag synchronously in their own
        // Esc branches; listeners run in registration order (ours first), so
        // defer the decision and exit the reader only when nothing else
        // handled the press. Progress is flushed on unmount.
        setTimeout(() => {
          if (consumeEscFlag()) return
          navigate({ to: '/' })
        }, 0)
        return
      }
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
  }, [readingMode, navigate])

  // Belt-and-braces: a stale "consumed" mark from a previous session (Esc
  // closed a popup, then the reader was left without another Esc) must not
  // swallow the first boss-key press of this session.
  useEffect(() => {
    consumeEscFlag()
  }, [])

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
      <TtsSessionProvider renderer={renderer}>
      <div className="fixed inset-0 z-30" style={{ backgroundColor: 'var(--bd-read-page-bg)', color: 'var(--bd-read-text)' }}>
        <div className="flex h-full w-full">
            <ReaderSidebar bookId={id} onStatsTabOpen={flushReadingTimer} chromePinned={chromePinned} />
          <div className="relative flex flex-1 flex-col">
            {/* Top hover zone: hot strip + header belong to the same group so hover is continuous.
                Touch: no group/hot strip — pinned (middle tap) is the only reveal. */}
            <div className={cn('absolute inset-x-0 top-0 z-40 pointer-events-none', !isTouch && 'group')}>
              {!isTouch && <div className="absolute inset-x-0 top-0 h-12 pointer-events-auto" />}
              <ReaderHeader
                title={currentChapter || book.title}
                visible
                pinned={chromePinned}
                settingsOpen={settingsOpen}
                ttsOpen={ttsOpen}
                bookId={id}
                estimatedMinutes={estimatedMinutes}
                onAddBookmark={onAddBookmark}
                onToggleSettings={onToggleSettings}
                onToggleTts={onToggleTts}
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
              // Solid theme background: the foliate iframe behind is blank
              // white until its theme styles are injected — without this the
              // loading overlay would flash white on every reader open
              <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[var(--bd-read-page-bg)] text-sm text-[var(--bd-read-sub)]">
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
                sit on the strip+footer wrapper, which has a real hit area so
                moving between its controls does not cause a false leave.
                Touch: summon/dwell stay inert (no sticky hover, no tap
                interception); the footer follows chromePinned alone. The
                mobile tool dock occupies the row below this progress strip. */}
            <div className="absolute inset-x-0 bottom-0 z-40 pointer-events-none">
              <div
                className={cn(
                  'absolute inset-x-0 bottom-0 h-12',
                  !isTouch && footerVisible ? 'pointer-events-auto' : 'pointer-events-none',
                )}
                onPointerEnter={isTouch ? undefined : () => setFooterSummon(true)}
                onPointerLeave={isTouch ? undefined : () => setFooterSummon(false)}
              >
                <div
                  className={cn(
                    'pointer-events-auto absolute inset-y-0 right-16',
                    (historyCaps.canBack || historyCaps.canForward) ? 'left-28' : 'left-0',
                    isTouch && 'pointer-events-none',
                  )}
                />
                <ProgressStrip
                  percent={percent}
                  pageInfo={pageInfo ?? undefined}
                  visible={footerVisible}
                  pinned={chromePinned}
                  mobileDockVisible={mobileDockVisible}
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
                    'absolute left-0 z-[60] h-24 w-28 transition-[bottom,translate] duration-300',
                    mobileDockVisible
                      ? 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]'
                      : 'bottom-0',
                    footerVisible
                      ? '-translate-y-10 pointer-events-auto'
                      : isTouch ? 'translate-y-full pointer-events-none' : 'pointer-events-none',
                  )}
                  onPointerEnter={isTouch ? undefined : () => setCornerDwell(true)}
                  onPointerLeave={isTouch ? undefined : () => setCornerDwell(false)}
                >
                  <HistoryCapsule
                    canBack={historyCaps.canBack}
                    canForward={historyCaps.canForward}
                    onBack={onHistoryBack}
                    onForward={onHistoryForward}
                  />
                </div>
              )}
              <ReaderFooterControls
                bookId={id}
                footerVisible={footerVisible}
                isTouch={isTouch}
                mobileDockVisible={mobileDockVisible}
                onPointerEnter={() => setCornerDwell(true)}
                onPointerLeave={() => setCornerDwell(false)}
                readingTimerMode={readingTimerMode}
              />
            </div>
          </div>
        </div>
        <SelectionToolbar bookId={id} fontStack={fontStack} fontCss={fontCss} />
        {footnoteEntry && (
          <FootnotePopup
            entry={footnoteEntry}
            onBack={() => rendererRef.current?.backFootnote()}
            onClose={() => rendererRef.current?.closeFootnote()}
          />
        )}
        <ShareCardDialog bookId={id} />
        {replaceTarget && (
          <Modal title={_('annotation.replaceSelection')} onClose={() => setReplaceTarget(null)}>
            <TransformForm
              bookId={id}
              selection={replaceTarget}
              onDone={() => setReplaceTarget(null)}
            />
          </Modal>
        )}
      </div>
      </TtsSessionProvider>
    </RendererContext.Provider>
    </ViewSettingsContext.Provider>
    </ErrorBoundary>
  )
}
