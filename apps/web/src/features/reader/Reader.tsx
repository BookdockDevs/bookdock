import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError, apiGet, apiPatch, apiPut } from '@/api/client'
import { usePrefetchBookReadingStats, useReadingRound } from '@/api/hooks/reading-records'
import { useBookReplacements } from '@/api/hooks/useReplacements'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage, getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { withReveal } from '@/lib/reveal-hidden'
import { useUiStore } from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'
import { isReaderContentTarget, isReaderModalOpen, isReaderShortcutModalOpen, readReaderShortcuts, shortcutMatches } from './lib/reader-shortcuts'
import { useSettingsSyncStore } from '@/stores/settings-sync.store'

import { cn } from '@/lib/utils'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { DialogLayoutContext } from '@/components/ui/dialog-layout-context'

import { useReaderRenderer } from './hooks/useReaderRenderer'
import { useReadingTimer } from './hooks/useReadingTimer'
import { useManualTimerStore } from './lib/manual-timer-store'
import { useIsTouch } from './hooks/useIsTouch'
import { useReaderState } from './state/reader-state'
import { RendererContext } from './hooks/useReaderApi'
import { TtsSessionProvider } from './hooks/TtsSessionProvider'
import { AutoReadingSessionProvider } from './hooks/AutoReadingSessionProvider'
import { useBookChapters } from './hooks/useBookChapters'
import { useReaderIdeas } from './hooks/useIdeas'
import { createSegmentTracker, trackPosition, closeSegment } from './stats/reading-segments'
import { createJumpHistory } from './jump-history'
import { createHistoryAutoHide, type HistoryAutoHide } from './history-auto-hide'
import { consumeEscFlag } from './lib/esc-consumed'
import { createRestoreGate, type RestoreGate } from './lib/restore-gate'
import { cfiRangesIntersect, loadCfiModule } from './lib/cfi-overlap'
import { mergeProgressSaveCache } from './lib/progress-cache'
import { buildRevisionContentUrl, prepareRevisionNavigation } from './lib/revision-navigation'
import { clearPreparedReaderContentText, primeReaderContentText, ReaderContentError } from './lib/reader-content-client'
import { getGuestProgress, saveGuestProgress } from './lib/guest-progress'
import { useCreateAnnotation, useAnnotations, useDeleteAnnotation } from './hooks/useAnnotations'
import { ReaderHeader } from './components/ReaderHeader'
import { ReaderSidebar } from './components/ReaderSidebar'
import { ReaderLoadingBadge } from './components/ReaderPending'
import ReaderKeyboardShortcuts from './components/ReaderKeyboardShortcuts'
import { Ribbon } from './components/Ribbon'
import { SelectionToolbar } from './components/SelectionToolbar'
import { clearReaderSelection } from './lib/reader-selection'
import { ImageContextMenu } from './components/ImageContextMenu'
import ShareCardDialog from './components/share/ShareCardDialog'
import { ProgressStrip } from './components/ProgressStrip'
import EndOfBookView from './components/EndOfBookView'
import ContentUpdateNotice from './components/ContentUpdateNotice'
import HistoryCapsule from './components/HistoryCapsule'
import ReaderFooterControls from './components/ReaderFooterControls'
import AutoReadingProgressBar from './components/AutoReadingProgressBar'
import { DEFAULT_IDEA_COLOR, getLastHighlightStyle } from './components/annotation-colors'
import { setActiveReplacements, setAutoMarkSelectionMode } from './renderers/FoliateReader'
import ReplacementForm from '../settings/components/ReplacementForm'
import { ViewSettingsContext } from './view-settings-context'
import { mergeViewSettings, viewSettingsDiffForKey, hasViewSettings } from './lib/view-settings'
import { readingRateOf, RATE_SAMPLE_MIN_INTERVAL_MS } from './lib/progress-model'
import { getSessionEpoch } from '@/lib/session-scope'
import type { PerBookSettingKey, PerBookSettingValue, GlobalViewSettings } from './lib/view-settings'
import type { BookReader, FootnoteEntry, ImageMediaContextInfo, ImageMediaInfo, ReaderAnnotation, SelectionInfo } from './types'
import { ReaderPlaybackCoordinator } from './lib/playback-coordinator'
import { FootnotePopup } from './components/FootnotePopup'
import { ImageViewer } from './components/ImageViewer'
import { BOOKMARK_CONTEXT_MAX_LENGTH } from '@bookdock/shared'
import type { AnnotationRes, BookDetailRes, BookListRes, ReaderBookSettings, ReadingProgressRes, ReadingProgressUpdateReq, ViewSettings } from '@bookdock/shared'

const RECENTLY_READ_QUERY = {
  page: 1,
  pageSize: 30,
  search: '',
  sortBy: 'lastReadAt',
  sortOrder: 'desc',
  shelfId: null,
  tagId: null,
  format: null,
  readStatus: null,
  trash: false,
  author: null,
  series: null,
  showHidden: false,
}

function isRecentlyReadQueryKey(queryKey: readonly unknown[]): boolean {
  if (queryKey[0] !== 'books' || !queryKey[1] || typeof queryKey[1] !== 'object') return false
  const params = queryKey[1] as Record<string, unknown>
  return Object.keys(params).length === Object.keys(RECENTLY_READ_QUERY).length
    && Object.entries(RECENTLY_READ_QUERY).every(([key, value]) => params[key] === value)
}

function isSelectionIdea(
  currentSelection: SelectionInfo | null,
  activeNoteEditor: string | null,
  annotationsList?: AnnotationRes[],
  markersList?: { annotation: { cfiRange: string } }[],
): boolean {
  if (activeNoteEditor) return true
  if (!currentSelection) return false
  if (currentSelection.isIdea || currentSelection.initialDetailId != null) return true
  if (annotationsList?.some((a) => a.cfiRange === currentSelection.cfiRange && a.type === 'note')) return true
  if (markersList?.some((p) => p.annotation.cfiRange === currentSelection.cfiRange)) return true
  return false
}

export default function Reader() {
  const _ = useTranslation()
  const { id } = useParams({ from: '/books/$id' })
  const authUser = useAuthStore((s) => s.user)
  const isGuest = !authUser
  const deepLinkParams = new URLSearchParams(window.location.search)
  const deepLinkAnnotation = deepLinkParams.get('annotation')
  const deepLinkCfi = deepLinkParams.get('cfi')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [percent, setPercent] = useState(0)
  const [displayedRevisionId, setDisplayedRevisionId] = useState<string | null>(null)
  const displayedRevisionIdRef = useRef<string | null>(null)
  const [revisionQuarantined, setRevisionQuarantined] = useState(false)
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number } | null>(null)
  const [currentContentCfi, setCurrentContentCfi] = useState<string | null>(null)
  const [chapterFraction, setChapterFraction] = useState<number | undefined>(undefined)
  const [_atChapterStart, setAtChapterStart] = useState(false)
  const [endOfBookMount, setEndOfBookMount] = useState<HTMLElement | null>(null)
  const readingRoundMutation = useReadingRound(id)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false)
  const [ttsOpen, setTtsOpen] = useState(false)
  const [autoReadingOpen, setAutoReadingOpen] = useState(false)
  const [footnoteEntry, setFootnoteEntry] = useState<FootnoteEntry | null>(null)
  const [imageViewer, setImageViewer] = useState<ImageMediaInfo | null>(null)
  const [imageContextMenu, setImageContextMenu] = useState<ImageMediaContextInfo | null>(null)
  const mediaErrorCooldownRef = useRef(false)
  // Chapter-switch loading indicator (slow cross-chapter navigation)
  const [navPending, setNavPending] = useState(false)
  const [navError, setNavError] = useState<{ target?: string; chapter?: string } | null>(null)
  // Changing the initial CFI ref alone cannot trigger the renderer effect.
  // This state records the explicit choice to bypass a failed restore.
  const [progressStartOver, setProgressStartOver] = useState(false)
  // A jump is in flight (target emitted at navigation start) — position/CFI
  // are not final until relocate, so e.g. a bookmark must not be taken mid-jump
  const navInFlightRef = useRef(false)
  // Destination chapter label shown while a jump is in flight — header display
  // only; the store's currentChapter stays the committed (relocate) value so
  // annotations saved mid-flight stay consistent.
  const [pendingNavChapter, setPendingNavChapter] = useState<string | null>(null)
  // Middle click-area tap reveals the top/bottom bars (mobile: no hover);
  // reading-area interactions hide them again, while footer controls keep them open for consecutive navigation
  const [chromePinned, setChromePinned] = useState(false)
  const keepChromePinnedRef = useRef(false)
  // Chrome visibility state machine: hot strips SUMMON the header/footer with a 180ms
  // debounce grace period; corner zones sustain the footer; touch uses chromePinned alone.
  const [headerSummon, setHeaderSummon] = useState(false)
  const [footerSummon, setFooterSummon] = useState(false)
  const [cornerDwell, setCornerDwell] = useState(false)
  const headerHotRef = useRef(false)
  const footerHotRef = useRef(false)
  const headerLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const footerLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [readerModalOpen, setReaderModalOpen] = useState(false)
  const readerModalOpenRef = useRef(false)

  const onHeaderEnter = useCallback(() => {
    if (headerLeaveTimerRef.current) {
      clearTimeout(headerLeaveTimerRef.current)
      headerLeaveTimerRef.current = null
    }
    setHeaderSummon(true)
  }, [])
  const onHeaderLeave = useCallback(() => {
    if (headerLeaveTimerRef.current) clearTimeout(headerLeaveTimerRef.current)
    headerLeaveTimerRef.current = setTimeout(() => {
      setHeaderSummon(false)
      headerLeaveTimerRef.current = null
    }, 180)
  }, [])

  const onFooterEnter = useCallback(() => {
    if (footerLeaveTimerRef.current) {
      clearTimeout(footerLeaveTimerRef.current)
      footerLeaveTimerRef.current = null
    }
    setFooterSummon(true)
  }, [])
  const onFooterLeave = useCallback(() => {
    if (footerLeaveTimerRef.current) clearTimeout(footerLeaveTimerRef.current)
    footerLeaveTimerRef.current = setTimeout(() => {
      setFooterSummon(false)
      footerLeaveTimerRef.current = null
    }, 180)
  }, [])

  const clearChromeSummon = useCallback(() => {
    headerHotRef.current = false
    footerHotRef.current = false
    setHeaderSummon(false)
    setFooterSummon(false)
    setCornerDwell(false)
    if (headerLeaveTimerRef.current) {
      clearTimeout(headerLeaveTimerRef.current)
      headerLeaveTimerRef.current = null
    }
    if (footerLeaveTimerRef.current) {
      clearTimeout(footerLeaveTimerRef.current)
      footerLeaveTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (headerLeaveTimerRef.current) clearTimeout(headerLeaveTimerRef.current)
      if (footerLeaveTimerRef.current) clearTimeout(footerLeaveTimerRef.current)
    }
  }, [])

  // Touch devices have no hover: the chrome hot zones stay inert and the
  // top/bottom controls are driven by the middle-tap chromePinned alone.
  const isTouch = useIsTouch()
  const [isSelectingText, setIsSelectingText] = useState(false)
  useEffect(() => {
    const syncReaderModal = () => {
      const open = document.querySelector('[data-reader-modal], [aria-modal="true"]') !== null
      if (readerModalOpenRef.current === open) return
      readerModalOpenRef.current = open
      setReaderModalOpen(open)
      if (open) clearChromeSummon()
    }
    syncReaderModal()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(syncReaderModal)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [clearChromeSummon])
  useEffect(() => {
    if (isTouch) return
    const updateHotZones = (clientX: number, clientY: number, buttons: number, hasSelection = false, target?: EventTarget | null) => {
      if (readerModalOpen || document.querySelector('[data-reader-modal], [aria-modal="true"]')) {
        clearChromeSummon()
        return
      }
      if (buttons || hasSelection || window.getSelection()?.type === 'Range') return
      const canvas = document.querySelector('[data-reader-canvas]')
      const rect = canvas?.getBoundingClientRect()
      const insideCanvas = rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
      const overDialog = target instanceof Element && Boolean(target.closest('[role="dialog"]'))
      const currentReadingMode = useUiStore.getState().readingMode
      const inHeader = Boolean(insideCanvas && !overDialog && rect && clientY <= rect.top + 48
        && (currentReadingMode !== 'scroll' || clientX < rect.right - 20))
      const inFooter = Boolean(insideCanvas && !overDialog && rect && clientY >= rect.bottom - 48
        && clientX >= rect.left
        && (currentReadingMode !== 'scroll' || clientX < rect.right - 20))
      if (inHeader !== headerHotRef.current) {
        headerHotRef.current = inHeader
        if (inHeader) onHeaderEnter()
        else onHeaderLeave()
      }
      if (inFooter !== footerHotRef.current) {
        footerHotRef.current = inFooter
        if (inFooter) onFooterEnter()
        else onFooterLeave()
      }
    }
    const onPointerMove = (event: PointerEvent) => updateHotZones(event.clientX, event.clientY, event.buttons, false, event.target)
    const clearHotZones = () => updateHotZones(-1, -1, 0)
    const onFramePointerMove = (event: Event) => {
      const detail = (event as CustomEvent<{ clientX: number; clientY: number; buttons: number; hasSelection: boolean }>).detail
      if (detail) updateHotZones(detail.clientX, detail.clientY, detail.buttons, detail.hasSelection)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('reader-pointermove', onFramePointerMove)
    window.addEventListener('pointerleave', clearHotZones)
    window.addEventListener('blur', clearHotZones)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('reader-pointermove', onFramePointerMove)
      window.removeEventListener('pointerleave', clearHotZones)
      window.removeEventListener('blur', clearHotZones)
      headerHotRef.current = false
      footerHotRef.current = false
    }
  }, [clearChromeSummon, isTouch, onHeaderEnter, onHeaderLeave, onFooterEnter, onFooterLeave, readerModalOpen])
  useEffect(() => {
    function onPointerUp() {
      setIsSelectingText(false)
    }
    window.addEventListener('pointerup', onPointerUp)
    return () => window.removeEventListener('pointerup', onPointerUp)
  }, [])
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null
      if (!target?.closest?.('[data-reader-corner-control]')) {
        setCornerDwell(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])
  const footerVisibleRef = useRef(false)
  const footerVisible = !readerModalOpen && (chromePinned || footerSummon || (footerVisibleRef.current && cornerDwell))
  const headerVisible = !readerModalOpen && (chromePinned || headerSummon || settingsOpen || ttsOpen || autoReadingOpen)
  useEffect(() => {
    footerVisibleRef.current = footerVisible
  }, [footerVisible])
  const rendererRef = useRef<BookReader | null>(null)
  const setSelection = useReaderState((s) => s.setSelection)
  const selection = useReaderState((s) => s.selection)
  const resetForBook = useReaderState((s) => s.resetForBook)
  const replaceTarget = useReaderState((s) => s.replaceTarget)
  const setReplaceTarget = useReaderState((s) => s.setReplaceTarget)
  const setTocItems = useReaderState((s) => s.setTocItems)
  const sidebarOpen = useReaderState((s) => s.sidebarOpen)
  const mobileDockVisible = isTouch && (chromePinned || sidebarOpen)
  const setSidebarOpen = useReaderState((s) => s.setSidebarOpen)
  const pendingTocHref = useReaderState((s) => s.pendingTocHref)
  const setPendingTocHref = useReaderState((s) => s.setPendingTocHref)
  const setPendingNavigationHref = useReaderState((s) => s.setPendingNavigationHref)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const currentChapterHref = useReaderState((s) => s.currentChapterHref)
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)
  const setCurrentChapter = useReaderState((s) => s.setCurrentChapter)
  const setCurrentChapterHref = useReaderState((s) => s.setCurrentChapterHref)
  const setCurrentChapterIndex = useReaderState((s) => s.setCurrentChapterIndex)
  const readingMode = useUiStore((s) => s.readingMode)
  const toolbarLocked = useUiStore((s) => s.toolbarLocked)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const ideaDisplayMode = useUiStore((s) => s.ideaDisplayMode)
  const ideaSidebarWidth = useUiStore((s) => s.ideaSidebarWidth)
  const dialogInset = !isTouch && (sidebarOpen || toolbarLocked) ? 56 + (sidebarOpen ? sidebarWidth : 0) : 0
  const createAnnotation = useCreateAnnotation(id)
  const deleteAnnotation = useDeleteAnnotation(id)
  const { data: annotations } = useAnnotations(id, { enabled: !isGuest && !revisionQuarantined })
  const showFriendIdeas = useUiStore((state) => state.showFriendIdeas)
  const publicIdeas = useReaderIdeas(id, showFriendIdeas && !revisionQuarantined, displayedRevisionId)
  const publicMarkers = useMemo(() => publicIdeas.isError || !showFriendIdeas ? [] : (publicIdeas.data?.data ?? []).filter((idea) => !idea.own && idea.locationAvailable), [publicIdeas.isError, publicIdeas.data, showFriendIdeas])
  const deepLinkHandled = useRef(false)
  const pendingDeepLink = useRef<string | null>(null)
  const annotationClickHandledRef = useRef(false)
  const annotationClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isIdeaSidebarOpen = Boolean(
    selection &&
    !isTouch &&
    ideaDisplayMode === 'sidebar' &&
    isSelectionIdea(selection, null, annotations?.data, publicMarkers),
  )

  const bookmarks = useMemo(
    () => displayedRevisionId
      ? (annotations?.data ?? []).filter((annotation) => annotation.type === 'bookmark' && annotation.locationAvailable !== false && (annotation.revisionId == null || annotation.revisionId === displayedRevisionId))
      : [],
    [annotations?.data, displayedRevisionId],
  )
  const [currentBookmarkId, setCurrentBookmarkId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!currentContentCfi || bookmarks.length === 0) {
      setCurrentBookmarkId(null)
      return () => { cancelled = true }
    }

    const exact = bookmarks.find((bookmark) => bookmark.cfiRange === currentContentCfi)
    if (exact) {
      setCurrentBookmarkId(exact.id)
      return () => { cancelled = true }
    }

    setCurrentBookmarkId(null)
    void loadCfiModule()
      .then((cfi) => {
        if (cancelled) return
        const match = bookmarks.find((bookmark) => cfiRangesIntersect(cfi, bookmark.cfiRange, currentContentCfi))
        setCurrentBookmarkId(match?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setCurrentBookmarkId(null)
      })

    return () => { cancelled = true }
  }, [bookmarks, currentContentCfi])

  const currentBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.id === currentBookmarkId),
    [bookmarks, currentBookmarkId],
  )

  const autoMarkSelection = useUiStore((s) => s.autoMarkSelection)
  useEffect(() => {
    setAutoMarkSelectionMode(autoMarkSelection)
  }, [autoMarkSelection])

  const bookQuery = useQuery({
    queryKey: ['book', id],
    queryFn: () => apiGet<{ data: BookDetailRes }>(withReveal(`/books/${id}`)),
    enabled: !!id && !revisionQuarantined,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  usePageTitle(bookQuery.data?.data?.title ?? _('reader.loading'))

  // --- Per-book reading settings (F1 layering) ---------------------------
  const fontSize = useUiStore((s) => s.fontSize)
  const cleanReading = useUiStore((s) => s.cleanReading)
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
    cleanReading,
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
    cleanReading, fontSize, lineHeight, pageWidth, horizontalPadding, verticalPadding, pageColumns, columnGap,
    scrollPageWidth, scrollHorizontalPadding, scrollVerticalPadding,
    pagePageWidth, pageHorizontalPadding, pageVerticalPadding, readingMode,
  ])
  const setFontSize = useUiStore((s) => s.setFontSize)
  const setCleanReading = useUiStore((s) => s.setCleanReading)
  const setLineHeight = useUiStore((s) => s.setLineHeight)
  const setPageWidth = useUiStore((s) => s.setPageWidth)
  const setHorizontalPadding = useUiStore((s) => s.setHorizontalPadding)
  const setVerticalPadding = useUiStore((s) => s.setVerticalPadding)
  const setPageColumns = useUiStore((s) => s.setPageColumns)
  const setColumnGap = useUiStore((s) => s.setColumnGap)
  const globalSetterForKey = useCallback(
    <K extends PerBookSettingKey,>(key: K, value: PerBookSettingValue<K>) => {
      if (key === 'cleanReading') {
        if (typeof value === 'boolean') setCleanReading(value)
        return
      }
      if (typeof value !== 'number') return
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
    [setCleanReading, setFontSize, setLineHeight, setPageWidth, setHorizontalPadding, setVerticalPadding, setPageColumns, setColumnGap],
  )

  // Per-book settings belong to the current user and BookVersion, not to the
  // shared content revision.
  const perBook = bookQuery.data?.data?.readerSettings?.viewSettings
  const effectiveSettings = useMemo(() => mergeViewSettings(globalSettings, perBook), [globalSettings, perBook])

  // Optimistic cache update so the panel and renderer follow immediately;
  // the PATCH itself is debounced and diffs are merged while pending.
  const saveViewSettingsMutation = useMutation({
    mutationFn: (viewSettings: ViewSettings | null) =>
      apiPatch<{ data: ReaderBookSettings }>(withReveal(`/books/${id}/reader-settings`), { viewSettings }),
    onMutate: (viewSettings) => {
      queryClient.setQueryData(['book', id], (old: { data: BookDetailRes } | undefined) => {
        if (!old?.data) return old
        const readerSettings = { ...(old.data.readerSettings ?? {}) }
        if (viewSettings === null) delete readerSettings.viewSettings
        else readerSettings.viewSettings = { ...(readerSettings.viewSettings ?? {}), ...viewSettings }
        return { ...old, data: { ...old.data, readerSettings } }
      })
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ['book', id] })
      notify.error(getUserErrorNotification(error, 'reader.settingsSaveFailed'), { dedupeKey: `reader-settings:${id}` })
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

  // --- Per-book preset binding ----------------------------------------------
  // Same optimistic-cache pattern as the viewSettings mutation above.
  const boundPresetId = bookQuery.data?.data?.readerSettings?.boundPresetId ?? null
  const bindPresetMutation = useMutation({
    mutationFn: (presetId: string | null) =>
      apiPatch<{ data: ReaderBookSettings }>(withReveal(`/books/${id}/reader-settings`), { boundPresetId: presetId }),
    onMutate: (presetId) => {
      queryClient.setQueryData(['book', id], (old: { data: BookDetailRes } | undefined) => {
        if (!old?.data) return old
        const readerSettings = { ...(old.data.readerSettings ?? {}) }
        if (presetId === null) delete readerSettings.boundPresetId
        else readerSettings.boundPresetId = presetId
        return { ...old, data: { ...old.data, readerSettings } }
      })
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ['book', id] })
      notify.error(getUserErrorNotification(error, 'reader.settingsSaveFailed'), { dedupeKey: `reader-settings:${id}` })
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
  const updateSetting = useCallback(<K extends PerBookSettingKey,>(key: K, value: PerBookSettingValue<K>) => {
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
    queryKey: ['progress', id, isGuest ? 'guest' : 'user'],
    queryFn: () => isGuest
      ? Promise.resolve({ data: getGuestProgress(id) })
      : apiGet<{ data: ReadingProgressRes | null }>(withReveal(`/progress/${id}`)),
    enabled: !!id,
  })

  const progressMutation = useMutation({
    mutationFn: async (body: ReadingProgressUpdateReq) => {
      if (isGuest) return { data: saveGuestProgress(id, body) }
      try {
        return await apiPut<{ data: ReadingProgressRes | null }>(withReveal(`/progress/${id}`), body)
      } catch (error) {
        pendingProgress.current ??= body
        throw error
      }
    },
    onMutate: async (body) => {
      if (!authUser) return
      await queryClient.cancelQueries({ queryKey: ['books'] })
      const book = bookQuery.data?.data
      const lastReadAt = Date.now()
      for (const query of queryClient.getQueryCache().findAll({ queryKey: ['books'] })) {
        if (!isRecentlyReadQueryKey(query.queryKey)) continue
        queryClient.setQueryData<BookListRes>(query.queryKey, (old) => {
          if (!old) return old
          const existing = old.data.find((item) => item.id === id)
          const source = existing ?? book
          if (!source) return old
          const promoted = {
            ...source,
            progress: body.percent,
            lastReadAt,
          }
          return {
            ...old,
            data: [promoted, ...old.data.filter((item) => item.id !== id)]
              .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
              .slice(0, old.data.length),
          }
        })
      }
    },
    onSuccess: (result) => {
      if (useAuthStore.getState().user?.id !== authUser?.id) return
      // The next reader entry latches initialCfi from this cache. If it holds
      // a stale position while the server holds a newer one, the mount saves
      // the stale position back and the background refetch flips the cache —
      // the two positions then alternate on every exit/re-enter. Keep the
      // cache in sync with the complete server response, including when the
      // previous cache was { data: null } for a book's first reading session.
      // Invalidate (without refetching) so the next mount still revalidates in
      // the background.
      queryClient.setQueryData(['progress', id, isGuest ? 'guest' : 'user'], (old: { data: ReadingProgressRes | null } | undefined) =>
        mergeProgressSaveCache(old, result),
      )
      void queryClient.invalidateQueries({ queryKey: ['progress', id, isGuest ? 'guest' : 'user'], refetchType: 'none' })
      if (!isGuest) void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
    onError: () => {
      if (!isGuest) void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
  })

  const pendingProgress = useRef<ReadingProgressUpdateReq | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mutateProgressRef = useRef(progressMutation.mutate)
  mutateProgressRef.current = progressMutation.mutate
  const restoreGateRef = useRef<RestoreGate | null>(null)
  if (restoreGateRef.current === null) restoreGateRef.current = createRestoreGate()

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

  const flushPendingProgress = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    // A body buffered while the restore gate is closed must never reach the
    // server — it holds a book-start position that would erase the saved one
    if (restoreGateRef.current?.isPending() || revisionQuarantinedRef.current) return
    if (pendingProgress.current) {
      mutateProgressRef.current(pendingProgress.current)
      pendingProgress.current = null
    }
  }, [])

  const openRestoreGate = useCallback(() => {
    // A body buffered while closed needs no immediate write: the next
    // relocate re-schedules it, and unmount/beforeunload flushes it
    restoreGateRef.current?.open()
  }, [])

  const scheduleProgressSave = useCallback(
    (body: ReadingProgressUpdateReq) => {
      pendingProgress.current = body
      // While a saved position awaits restore, buffer only — openRestoreGate
      // (rendered / explicit jump) re-arms the timer with the settled body
      if (restoreGateRef.current?.isPending()) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flushPendingProgress, 600)
    },
    [flushPendingProgress]
  )

  useEffect(() => {
    const flush = flushPendingProgress
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [flushPendingProgress])

  const chaptersQuery = useBookChapters(id, !revisionQuarantined)

  // Progress load failures get a dedicated in-page prompt (retry / start
  // over) instead of a toast — the reader must not silently mount anywhere
  const chaptersErrorShownRef = useRef(false)
  useEffect(() => {
    if (!chaptersQuery.isError) {
      chaptersErrorShownRef.current = false
      return
    }
    if (chaptersQuery.error instanceof ApiError && chaptersQuery.error.code === 'UNAUTHORIZED') return
    if (chaptersErrorShownRef.current) return
    chaptersErrorShownRef.current = true
    notify.error({ key: 'reader.chapterLoadFailed' })
  }, [chaptersQuery.error, chaptersQuery.isError])

  // Gated on bookQuery data: the reader mounts once bookQuery data exists (from
  // cache on reopen or after the initial fetch).
  const contentUrl = id && bookQuery.data?.data
    ? withReveal(`/api/v1/books/${id}/file?reader=1&revisionId=${encodeURIComponent(bookQuery.data.data.revisionId ?? '')}&v=${bookQuery.data.data.updatedAt}`)
    : ''
  const [revisionUrlOverride, setRevisionUrlOverride] = useState<string | null>(null)
  const [revisionMountGeneration, setRevisionMountGeneration] = useState(0)
  const committedMountGenerationRef = useRef(0)
  const revisionSwitchRef = useRef<{ generation: number; controller: AbortController; revisionId: string } | null>(null)
  const revisionSwitchGeneration = useRef(0)
  const revisionStartupTargetRef = useRef<string | null>(null)
  const latestTocSelectionRef = useRef<{ revisionId: string; previousRevisionId: string; previousContentHash: string | null } | null>(null)
  const revisionSwitchingRef = useRef(false)
  const revisionQuarantinedRef = useRef(false)
  const lastRenderedContentUrlRef = useRef<string | null>(null)
  const rendererContentUrl = revisionUrlOverride ?? contentUrl

  useEffect(() => {
    clearPreparedReaderContentText()
    revisionSwitchRef.current?.controller.abort()
    revisionSwitchRef.current = null
    revisionSwitchingRef.current = false
    revisionQuarantinedRef.current = false
    setRevisionQuarantined(false)
    displayedRevisionIdRef.current = null
    setDisplayedRevisionId(null)
    lastRenderedContentUrlRef.current = null
    revisionStartupTargetRef.current = null
    latestTocSelectionRef.current = null
    setRevisionUrlOverride(null)
    return () => {
      revisionSwitchRef.current?.controller.abort()
      revisionSwitchRef.current = null
    }
  }, [id, authUser?.id])

  // Latch initialCfi at first resolve: later refetches of ['progress'] (e.g.
  // StatsPanel mounting) must not remount the renderer
  const initialCfiRef = useRef<string | undefined>(undefined)
  const initialFractionRef = useRef<number | undefined>(undefined)
  const initialCfiBookRef = useRef(id)
  if (initialCfiBookRef.current !== id) {
    initialCfiBookRef.current = id
    initialCfiRef.current = undefined
    initialFractionRef.current = undefined
    // The previous book's unsaved position must never flush into this one,
    // and this book's gate starts unarmed until progress latches
    restoreGateRef.current?.open()
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    pendingProgress.current = null
  }
  // Success only: a failed progress fetch must not be latched as "no saved
  // progress" — the reader shows a retry/start-over prompt until it resolves
  if (initialCfiRef.current === undefined) {
    if (progressQuery.isSuccess) {
      const data = progressQuery.data?.data
      initialCfiRef.current = data?.cfi ?? ''
      // Book-level fraction fallback: used when no CFI was saved (stale after
      // a re-TOC) and by the renderer when the saved CFI fails to resolve
      // (content is unchanged, so the fraction still lands on the same text).
      initialFractionRef.current = data && data.percent > 0 ? data.fraction ?? data.percent / 100 : undefined
      restoreGateRef.current?.arm()
    } else if (bookQuery.data?.data && bookQuery.data.data.cfi !== undefined) {
      const bData = bookQuery.data.data
      initialCfiRef.current = bData.cfi ?? ''
      initialFractionRef.current = bData.progress && bData.progress > 0 ? (bData.readFraction ?? bData.progress / 100) : undefined
      restoreGateRef.current?.arm()
    }
  }

  const [bookReady, setBookReady] = useState(false)
  const [readyContentUrl, setReadyContentUrl] = useState<string | null>(null)
  // The view is torn down and rebuilt for content replacements and Chinese
  // conversion. While that happens the reading area is empty, so the loading
  // surface has to come back — it is keyed to the renderer, not to the file.
  const [viewRebuilding, setViewRebuilding] = useState(false)
  const readerReady = bookReady
    && (readyContentUrl === rendererContentUrl || revisionSwitchingRef.current)
    && !viewRebuilding
  // kind=parse: renderer onError, the file itself failed to load
  const [loadError, setLoadError] = useState<{ kind: 'parse' } | null>(null)
  // Slow-network hint: the Range path has no global time budget, so a load
  // past 30s is slow, not failed — say "still loading" instead of the old
  // false timeout card (which then self-healed when the load arrived late).
  // Real failures keep coming through the renderer's onError.
  const [slowLoad, setSlowLoad] = useState(false)
  useEffect(() => {
    if (revisionSwitchingRef.current) return
    setBookReady(false)
    setReadyContentUrl(null)
    setLoadError(null)
    setSlowLoad(false)
  }, [rendererContentUrl])

  useEffect(() => {
    if (readerReady || !rendererContentUrl) return
    const timer = setTimeout(() => setSlowLoad(true), 30000)
    return () => clearTimeout(timer)
  }, [readerReady, rendererContentUrl])

  // Both mode uses automatic capture until the manual timer takes ownership.
  const readingTimerMode = useUiStore((s) => s.readingTimerMode)
  const { flush: flushReadingTimer, ping: pingReadingTimer } = useReadingTimer(
    !isGuest && (readingTimerMode === 'auto' || readingTimerMode === 'both') ? (readerReady ? id : undefined) : undefined,
  )
  // Warm the sidebar stats tab's queries so first open is instant
  usePrefetchBookReadingStats(isGuest ? undefined : id)

  // Per-chapter word counts for the info-bar field; must precede useReaderRenderer
  const chapterWordCounts = useMemo(() => {
    const chapters = chaptersQuery.data?.data
    if (!chapters?.length) return undefined
    return chapters.map((c) => (c.wordCount != null
      ? c.wordCount
      : c.endOffset - (c.contentStartOffset ?? c.startOffset)))
  }, [chaptersQuery.data])

  // Text replacements (文本替换 P1): the module-level rule set must be populated
  // before the renderer mounts (replacements apply at section load time), so
  // this effect is declared before useReaderRenderer. Cleared on unmount and
  // book switch so rules never leak into another book's reader.
  // A late-arriving rule set would rebuild the whole view after the first
  // paint (close + open + re-navigate), so the renderer waits for it.
  const { data: replacementsData, isError: replacementsError } = useBookReplacements(id)
  const replacementRules = useMemo(() => replacementsData?.data ?? [], [replacementsData])
  const replacementsReady = replacementsData !== undefined || replacementsError
  useEffect(() => {
    setActiveReplacements(replacementRules)
    return () => setActiveReplacements([])
  }, [replacementRules])

  // A stale replace dialog must not follow the reader into another book
  useEffect(() => {
    setReplaceTarget(null)
    setImageViewer(null)
    setImageContextMenu(null)
    deepLinkHandled.current = false
    pendingDeepLink.current = null
    setProgressStartOver(false)
  }, [id, setReplaceTarget])

  const dismissChrome = useCallback(() => {
    keepChromePinnedRef.current = false
    setChromePinned(false)
    setHeaderSummon(false)
    setFooterSummon(false)
    setCornerDwell(false)
    footerVisibleRef.current = false
    if (headerLeaveTimerRef.current) {
      clearTimeout(headerLeaveTimerRef.current)
      headerLeaveTimerRef.current = null
    }
    if (footerLeaveTimerRef.current) {
      clearTimeout(footerLeaveTimerRef.current)
      footerLeaveTimerRef.current = null
    }
    setSettingsOpen(false)
    const dismissibleSidebarOpen = sidebarOpen && (isTouch || !toolbarLocked)
    if (dismissibleSidebarOpen) setSidebarOpen(false)
  }, [isTouch, setSidebarOpen, sidebarOpen, toolbarLocked])

  // One definition of "toggle the reading chrome", shared by the middle-tap
  // gesture and the space key: the dismissal rules (locked desktop sidebar is
  // persistent) are subtle enough that a second copy would drift.
  const toggleChrome = useCallback(() => {
    keepChromePinnedRef.current = false
    // Tap-to-toggle: anything visible (pinned bars, summoned bars, settings popover,
    // or a dismissible sidebar) closes on tap. A locked desktop sidebar is
    // persistent and must not participate in reading-chrome dismissal.
    const dismissibleSidebarOpen = sidebarOpen && (isTouch || !toolbarLocked)
    const isShowing = chromePinned || headerVisible || footerVisible || settingsOpen || dismissibleSidebarOpen
    if (isShowing) {
      dismissChrome()
    } else {
      setChromePinned(true)
    }
  }, [chromePinned, headerVisible, footerVisible, settingsOpen, sidebarOpen, isTouch, toolbarLocked, dismissChrome])

  const settingsSync = useSettingsSyncStore()
  const resolvedBoundPresetId = useUiStore((s) => s.boundPresetId)
  const settingsReady = isGuest || (settingsSync.userId === authUser?.id && settingsSync.ready)
  const settingsFailed = !isGuest && settingsSync.userId === authUser?.id && settingsSync.failed

  const switchRevisionForNavigation = useCallback(async (intent: {
    target?: string
    sectionHref?: string
    chapterNavigation: boolean
    previousRevisionId: string
    previousContentHash: string | null
    explicitRevisionId?: string
  }) => {
    if (!contentUrl || !bookQuery.data?.data) return
    const generation = ++revisionSwitchGeneration.current
    revisionSwitchRef.current?.controller.abort()
    const controller = new AbortController()
    revisionSwitchRef.current = { generation, controller, revisionId: '' }
    revisionSwitchingRef.current = true
    revisionQuarantinedRef.current = true
    setRevisionQuarantined(true)
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    pendingProgress.current = null
    navInFlightRef.current = true

    try {
      const prepared = await prepareRevisionNavigation(contentUrl, {
        bookId: id,
        revisionId: intent.previousRevisionId,
        contentHash: intent.previousContentHash,
        generated: bookQuery.data.data.format === 'txt',
      }, intent, controller.signal)
      if (generation !== revisionSwitchGeneration.current || controller.signal.aborted) return
      const { latest, target, targetPath, targetText, toc } = prepared
      if (!target) {
        if (toc.length) {
          latestTocSelectionRef.current = {
            revisionId: latest.manifest.revisionId,
            previousRevisionId: intent.previousRevisionId,
            previousContentHash: intent.previousContentHash,
          }
          setTocItems(toc, id)
          setSidebarOpen(true)
        }
        navInFlightRef.current = false
        revisionSwitchingRef.current = false
        revisionSwitchRef.current = null
        setNavPending(false)
        setPendingNavChapter(null)
        return
      }

      const latestUrl = buildRevisionContentUrl(contentUrl, latest.manifest.revisionId)
      if (generation !== revisionSwitchGeneration.current || controller.signal.aborted || getSessionEpoch() !== latest.epoch) return
      if (!targetPath || targetText === null) throw new ReaderContentError('READER_ENTRY_FAILED', 'The prepared reader chapter could not be transferred')
      primeReaderContentText(latest.manifest, latest.accountScope, targetPath, targetText)

      revisionStartupTargetRef.current = target
      if (intent.explicitRevisionId) {
        latestTocSelectionRef.current = {
          revisionId: latest.manifest.revisionId,
          previousRevisionId: intent.previousRevisionId,
          previousContentHash: intent.previousContentHash,
        }
      }
      revisionSwitchRef.current = { generation, controller, revisionId: latest.manifest.revisionId }
      setNavError(null)
      setPendingNavChapter(null)
      setNavPending(true)
      setRevisionUrlOverride(latestUrl)
      setRevisionMountGeneration((current) => current + 1)
    } catch (error) {
      if (controller.signal.aborted || generation !== revisionSwitchGeneration.current) return
      navInFlightRef.current = false
      revisionSwitchingRef.current = false
      revisionSwitchRef.current = null
      setNavPending(false)
      setPendingNavChapter(null)
      if (error instanceof ReaderContentError && ['UNAUTHORIZED', 'FORBIDDEN', 'BOOK_NOT_FOUND', 'BOOK_FILE_MISSING', 'BOOK_NOT_ACCESSIBLE'].includes(error.code)) {
        return
      }
      notify.error({ key: 'reader.navigationLoadFailed' })
    }
  }, [bookQuery.data, contentUrl, id, setSidebarOpen, setTocItems])

  const { containerRef, renderer, fontStack, fontCss, preparationFailed, retryPreparation } = useReaderRenderer({
    ready: settingsReady && resolvedBoundPresetId === boundPresetId && replacementsReady,
    url: rendererContentUrl,    // undefined while progress is still loading: the renderer defers mounting
    mountGeneration: revisionMountGeneration,
    bookId: id,
    format: bookQuery.data?.data?.format,
    bookSize: bookQuery.data?.data?.size,
    // so it navigates exactly once (to the saved CFI, or to the book start
    // when progress resolved to none)
    initialCfi: initialCfiRef.current,
    initialFraction: initialFractionRef.current,
    settings: effectiveSettings,
    onViewRebuilding: (pending) => setViewRebuilding(pending),
    chapterWordCounts,
    onRendered: (renderedUrl) => {
      if (renderedUrl) lastRenderedContentUrlRef.current = renderedUrl
      committedMountGenerationRef.current = revisionMountGeneration
      const activeSwitch = revisionSwitchRef.current
      const renderedRevisionId = renderedUrl
        ? new URLSearchParams(new URL(renderedUrl, window.location.href).search).get('revisionId')
        : null
      if (activeSwitch?.revisionId && activeSwitch.revisionId === renderedRevisionId) {
        revisionSwitchRef.current = null
        revisionSwitchingRef.current = false
        revisionQuarantinedRef.current = false
        setRevisionQuarantined(false)
        revisionStartupTargetRef.current = null
        latestTocSelectionRef.current = null
        displayedRevisionIdRef.current = activeSwitch.revisionId
        setDisplayedRevisionId(activeSwitch.revisionId)
        void queryClient.invalidateQueries({ queryKey: ['progress', id, isGuest ? 'guest' : 'user'] })
        void queryClient.invalidateQueries({ queryKey: ['chapters', id] })
        void queryClient.invalidateQueries({ queryKey: ['annotations', id] })
        void queryClient.invalidateQueries({ queryKey: ['reader-ideas', id] })
        void queryClient.invalidateQueries({ queryKey: ['idea-composer', id] })
      }
      if (!activeSwitch?.revisionId && renderedRevisionId) {
        displayedRevisionIdRef.current = renderedRevisionId
        setDisplayedRevisionId(renderedRevisionId)
      }
      setBookReady(true)
      if (renderedUrl) {
        setReadyContentUrl(renderedUrl)
        setRevisionUrlOverride((current) => current ?? renderedUrl)
      }
      setLoadError(null)
      // Initial navigation (saved position, fraction fallback, or book
      // start) has settled — relocate-driven saves may write back again
      openRestoreGate()
    },
    onReady: () => {
      const revisionTarget = revisionStartupTargetRef.current
      if (revisionTarget) {
        revisionStartupTargetRef.current = null
        return revisionTarget
      }
      const pendingHref = useReaderState.getState().pendingTocHref
      if (!pendingHref) return undefined
      setPendingTocHref(null)
      return pendingHref
    },
    onError: () => {
      clearPreparedReaderContentText()
      if (revisionSwitchRef.current?.revisionId) {
        revisionSwitchRef.current = null
        revisionSwitchingRef.current = false
        navInFlightRef.current = false
        setNavPending(false)
        setPendingNavChapter(null)
        setRevisionUrlOverride(lastRenderedContentUrlRef.current)
        setRevisionMountGeneration(committedMountGenerationRef.current)
        setLoadError(null)
        notify.warning(_('reader.navigationLoadFailed'))
        return
      }
      setLoadError({ kind: 'parse' })
    },
    onFootnoteOpen: (entry) => {
      clearReaderSelection(rendererRef.current)
      setSettingsOpen(false)
      setAutoReadingOpen(false)
      setFootnoteEntry(entry)
    },
    onFootnoteClose: () => setFootnoteEntry(null),
    onImageClicked: (image) => {
      setImageContextMenu(null)
      setImageViewer(image)
    },
    onImageContextMenu: (image) => {
      setImageViewer(null)
      setImageContextMenu(image)
    },
    onMediaError: () => {
      if (mediaErrorCooldownRef.current) return
      mediaErrorCooldownRef.current = true
      setTimeout(() => { mediaErrorCooldownRef.current = false }, 3000)
      notify.error({ key: 'reader.mediaLoadFailed' })
    },
    onMediaPlay: () => {
      void playbackCoordinator.claim('media')
    },
    onRelocated: (e) => {
      const pendingHref = useReaderState.getState().pendingNavigationHref
      if (pendingHref) {
        const pendingChapterIndex = pendingHref.startsWith('chapter:')
          ? Number(pendingHref.split(':')[1])
          : null
        if (e.chapterHref === pendingHref || (Number.isInteger(pendingChapterIndex) && e.chapterIndex === pendingChapterIndex)) {
          setPendingNavigationHref(null)
        }
      }
      // The destination is now the committed position — drop the pre-update
      navInFlightRef.current = false
      setPendingNavChapter(null)
      setNavError(null)
      if (e.source !== 'tts' && !keepChromePinnedRef.current) {
        setChromePinned(false)
        setCornerDwell(false)
      }
      const activeNoteEditor = useReaderState.getState().noteEditorRange
      const chapterChanged = Boolean(
        (e.chapterHref && currentChapterHref && e.chapterHref !== currentChapterHref) ||
        (e.chapterIndex !== undefined && currentChapterIndex !== null && e.chapterIndex !== currentChapterIndex),
      )
      if (chapterChanged) {
        if (!activeNoteEditor) clearReaderSelection(rendererRef.current)
      }
      setPercent(e.percent)
      setCurrentContentCfi(e.contentCfi ?? null)
      currentCfiRef.current = e.cfi
      setChapterFraction(e.chapterFraction)
      if (e.page !== undefined && e.total !== undefined) {
        setPageInfo({ page: e.page, total: e.total })
      }
      setCurrentChapterHref(e.chapterHref ?? null)
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
      const eventRevisionId = e.revisionId
      const expectedRevisionId = revisionSwitchRef.current?.revisionId || displayedRevisionIdRef.current
      if (revisionQuarantinedRef.current || !expectedRevisionId || eventRevisionId !== expectedRevisionId) return
      // Navigation-aware coverage belongs to the record, independently of position saves.
      const segmentStartFraction = readingTimerMode !== 'off' && e.fraction !== undefined
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
      const readingPosition = { cfi: e.cfi, fraction: e.fraction, segmentStart: segmentStartFraction,
        revisionId: expectedRevisionId, wordCount: bookQuery.data?.data.meta?.wordCount ?? undefined }
      pingReadingTimer(readingPosition)
      useManualTimerStore.getState().updatePosition(id, { ...readingPosition, fraction: e.fraction ?? null, chapterIndex: e.chapterIndex })
      scheduleProgressSave({ cfi: e.cfi, chapter: e.chapter, ...(e.chapterIndex === undefined ? {} : { chapterIndex: e.chapterIndex }), percent: e.percent, fraction: e.fraction, sample })
    },
    onSelected: (e) => {
      setIsSelectingText(false)
      if (e) setChromePinned(false)
      setSelection(e)
    },
    onTextSelectionStart: () => {
      setIsSelectingText(true)
      setFooterSummon(false)
      setHeaderSummon(false)
    },
    onAnnotationClicked: (e) => {
      annotationClickHandledRef.current = true
      if (annotationClickTimerRef.current) {
        clearTimeout(annotationClickTimerRef.current)
      }
      annotationClickTimerRef.current = setTimeout(() => {
        annotationClickHandledRef.current = false
        annotationClickTimerRef.current = null
      }, 400)

      const current = useReaderState.getState().selection
      // A range can hold both a highlight and ideas; the highlight wins the
      // click (same rule as SelectionToolbar), ideas stay reachable from the
      // notes side panel
      const currentRevisionAnnotations = annotations?.data?.filter((a) => a.revisionId == null || a.revisionId === displayedRevisionId)
      const annotation = currentRevisionAnnotations?.find((a) => a.cfiRange === e.cfiRange && a.type === 'highlight')
        ?? currentRevisionAnnotations?.find((a) => a.cfiRange === e.cfiRange)
        ?? publicMarkers.find((idea) => idea.annotation.cfiRange === e.cfiRange)?.annotation
      const isSameSelection = current?.cfiRange === e.cfiRange && Boolean(current?.isIdea) === (annotation?.type === 'note')
      if (!annotation || isSameSelection) {
        clearReaderSelection(rendererRef.current)
        return
      }
      rendererRef.current?.deselect()
      setSelection({
        cfiRange: e.cfiRange,
        text: annotation.text,
        rect: e.rect,
        isIdea: annotation.type === 'note',
      })
    },
    onTocReady: (items) => setTocItems(items, id),
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
    onNavigatePending: (e) => {
      // The start event carries the destination hint immediately, but the
      // spinner itself is delayed by NavigationPending to avoid fast-jump
      // flashes. A fast relocate may settle before that delayed event exists.
      if (!e.started) setNavPending(e.pending)
      if (e.started) setNavError(null)
      if (e.target) {
        const { sectionIndex, isJump } = e.target
        // Same-chapter page turns do not touch the UI, but explicit same-
        // section jumps still need the in-flight guard for bookmarks.
        if (isJump || sectionIndex !== currentChapterIndex) {
          navInFlightRef.current = true
        }
        if (sectionIndex !== currentChapterIndex) {
          const label = sectionTocLabels?.[sectionIndex]
          if (label) setPendingNavChapter(label)
        }
        // Keep progress tied to the last committed relocation. Updating it
        // optimistically would leave the progress bar on the failed target.
      }
    },
    onRevisionChanged: () => {
      revisionQuarantinedRef.current = true
      setRevisionQuarantined(true)
      void queryClient.cancelQueries({ queryKey: ['progress', id, isGuest ? 'guest' : 'user'] })
      void queryClient.cancelQueries({ queryKey: ['chapters', id] })
      void queryClient.cancelQueries({ queryKey: ['annotations', id] })
      void queryClient.cancelQueries({ queryKey: ['reader-ideas', id] })
      closeSegment(segmentTrackerRef.current)
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      pendingProgress.current = null
    },
    onRevisionNavigation: (intent) => void switchRevisionForNavigation(intent),
    onNavigateError: (e) => {
      navInFlightRef.current = false
      setNavPending(false)
      // The renderer keeps the last successfully relocated section visible.
      // Do not leave the failed destination in the header or let its
      // optimistic progress look committed.
      setPendingNavChapter(null)
      if (e.target && e.target === pendingDeepLink.current) {
        pendingDeepLink.current = null
        setNavError(null)
        notify.warning(_('profileArchive.positionUnavailable'))
        return
      }
      setNavError({
        target: e.target,
        chapter: e.sectionIndex === undefined ? undefined : sectionTocLabels?.[e.sectionIndex],
      })
    },
    onChromeToggle: toggleChrome,
    onUserJump: () => {
      // An explicit jump supersedes the in-flight restore: wherever the
      // user lands is their intent and may be saved
      openRestoreGate()
      closeSegment(segmentTrackerRef.current)
    },
    onReplacementInvalid: (e) => {
      // The same invalid patch is reported again on every section reload —
      // toast only the freshly discovered ones
      const known = useReaderState.getState().invalidReplacementIds
      const fresh = e.ids.filter((id) => !known.includes(id))
      if (fresh.length) {
        notify.error({ key: 'reader.replacementsInvalidToast', params: { count: fresh.length } })
      }
      useReaderState.getState().addInvalidReplacementIds(e.ids)
    },
    onAnnotationOrphaned: (e) => {
      useReaderState.getState().addOrphanedAnnotationKeys([`${e.cfiRange}|${e.type}`])
    },
    onInstantAnnotation: (e) => {
      if (revisionQuarantinedRef.current || !displayedRevisionId) return
      const lastStyle = getLastHighlightStyle()
      createAnnotation.mutate({
        cfiRange: e.cfiRange,
        cfiAnchor: e.cfiRange,
        type: 'highlight',
        // Same rawText preference as the toolbar — see SelectionToolbar.highlight
        text: e.rawText ?? e.text,
        color: lastStyle.color,
        style: lastStyle.style,
        chapter: currentChapter ?? undefined,
        revisionId: displayedRevisionId ?? undefined,
        ...(currentChapterHref ? { chapterHref: currentChapterHref } : {}),
      }, { onError: (err) => notify.error(getUserErrorNotification(err, 'annotation.saveFailed')) })
      // "选中即划" keeps the toolbar open so the fresh highlight can be restyled
      if (!e.keepSelection) clearReaderSelection(rendererRef.current)
    },
    onEndOfBookMount: (el) => {
      setEndOfBookMount(el)
    },
  })

  // Renderer replacement briefly clears `renderer`; keep the last confirmed
  // format capability so the open settings panel does not remove and recreate
  // the clean-reading row during that transition.
  const cleanReadingSupportRef = useRef({ bookId: '', supported: false })
  const bookFormat = bookQuery.data?.data?.format
  if (cleanReadingSupportRef.current.bookId !== id) {
    cleanReadingSupportRef.current = { bookId: id, supported: false }
  }
  if (bookFormat !== 'epub') {
    cleanReadingSupportRef.current.supported = false
  } else if (renderer) {
    cleanReadingSupportRef.current.supported = !renderer.isFixedLayout
  }
  const cleanReadingSupported = bookFormat === 'epub' && cleanReadingSupportRef.current.supported

  const playbackCoordinator = useMemo(() => new ReaderPlaybackCoordinator(), [])

  // A renderer that is replaced (book switch, settings flip) must not leave
  // the loading surface stuck over a reader that is already gone.
  useEffect(() => { setViewRebuilding(false) }, [renderer])

  useEffect(() => {
    if (deepLinkHandled.current || !readerReady || !renderer) return
    const annotation = deepLinkAnnotation
      ? annotations?.data?.find((item) => item.id === deepLinkAnnotation)
      : undefined
    if (deepLinkAnnotation && !annotation) {
      if (annotations?.data) {
        deepLinkHandled.current = true
        notify.warning(_('profileArchive.positionUnavailable'))
      }
      return
    }
    if (annotation && (annotation.locationAvailable === false || (annotation.revisionId != null && annotation.revisionId !== displayedRevisionId))) {
      deepLinkHandled.current = true
      notify.warning(_('profileArchive.positionUnavailable'))
      return
    }
    const target = deepLinkCfi || annotation?.cfiRange || annotation?.cfiAnchor
    if (!target) return
    deepLinkHandled.current = true
    pendingDeepLink.current = target
    void renderer.display(target).finally(() => {
      if (pendingDeepLink.current === target) pendingDeepLink.current = null
    })
  }, [annotations?.data, displayedRevisionId, readerReady, deepLinkAnnotation, deepLinkCfi, renderer, _])

  // A TOC jump clicked before the renderer became available is queued in the
  // store — apply it as soon as the live renderer can accept navigation.
  useEffect(() => {
    if (!renderer || !pendingTocHref) return
    const href = pendingTocHref
    setPendingTocHref(null)
    const latestTocSelection = latestTocSelectionRef.current
    if (latestTocSelection && revisionQuarantinedRef.current) {
      void switchRevisionForNavigation({
        target: href,
        sectionHref: href.split('#', 1)[0],
        chapterNavigation: true,
        previousRevisionId: latestTocSelection.previousRevisionId,
        previousContentHash: latestTocSelection.previousContentHash,
        explicitRevisionId: latestTocSelection.revisionId,
      })
      return
    }
    void renderer.display(href)
  }, [pendingTocHref, renderer, setPendingTocHref, switchRevisionForNavigation])

  // Rule-set changes after mount must invalidate the cached sections: the
  // renderer tears the view down and reopens it (same mechanism as the
  // Chinese-conversion switch). No-op while the query is still loading.
  useEffect(() => {
    if (!renderer || replacementsData === undefined) return
    void renderer.applyTextReplacements(replacementRules)
  }, [renderer, replacementRules, replacementsData])

  // Byte-weight section boundaries (foliate's own progress model) for the
  // progress strip's drag preview — same model the seek lands by, so the
  // previewed chapter always matches the landing chapter
  const [sectionFractions, setSectionFractions] = useState<number[] | null>(null)
  const [sectionTocLabels, setSectionTocLabels] = useState<string[] | null>(null)
  useEffect(() => {
    setSectionFractions(renderer?.getSectionFractions?.() ?? null)
    setSectionTocLabels(renderer?.getSectionTocLabels?.() ?? null)
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
      .filter((a) => a.revisionId == null || a.revisionId === displayedRevisionId)
      .filter((a) => a.type === 'highlight' || (a.type === 'note' && a.locationAvailable !== false))
      .map((a) => ({ cfiRange: a.cfiRange, type: a.type as 'highlight' | 'note', color: a.color, style: a.style, note: a.note }))
    list.push(...publicMarkers.map((idea) => ({ cfiRange: idea.annotation.cfiRange, type: 'note' as const, color: DEFAULT_IDEA_COLOR, style: 'underline' as const, note: idea.annotation.note })))
    // An idea being composed has no row yet; a pseudo note keeps the dashed
    // underline on its range while the editor is open
    if (noteEditorRange) {
      list.push({ cfiRange: noteEditorRange, type: 'note', color: DEFAULT_IDEA_COLOR, style: 'underline' })
    }
    renderer.setAnnotations(list)
  }, [renderer, annotations?.data, publicMarkers, displayedRevisionId, noteEditorRange])

  useEffect(() => {
    // A locked desktop toolbar is persistent by intent — reopen the sidebar
    // with it, unless the user last collapsed it (remembered while locked).
    // Touch devices have no lock, so the sidebar always starts closed.
    const ui = useUiStore.getState()
    resetForBook(
      !isTouch && ui.toolbarLocked && ui.sidebarRememberedOpen,
      ui.navTabRemembered,
    )
    // chapterCount starts empty; the effect below syncs it when chapters arrive
    segmentTrackerRef.current = createSegmentTracker()
    lastSegmentStartRef.current = null
    lastSampleAtRef.current = 0
    jumpHistoryRef.current.clear()
    syncHistoryCaps()
    historyAutoHideRef.current?.dispose()
    currentCfiRef.current = null
    setCurrentContentCfi(null)
  }, [id, resetForBook, syncHistoryCaps, isTouch])

  // While locked, every open/closed toggle is a deliberate choice — remember
  // it (device-local) so the next book open honors it instead of forcing open.
  // Skip stale renders: on a cold refresh the seed effect above has already
  // opened the sidebar while this render still holds the initial `false`, and
  // recording that would wipe the memory before the seed value lands.
  useEffect(() => {
    if (isTouch || !toolbarLocked) return
    if (useReaderState.getState().sidebarOpen !== sidebarOpen) return
    useUiStore.getState().setSidebarRememberedOpen(sidebarOpen)
  }, [sidebarOpen, toolbarLocked, isTouch])

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
      if (annotationClickHandledRef.current) return
      setSettingsOpen(false)
      setTtsOpen(false)
      setAutoReadingOpen(false)
      const currentSelection = useReaderState.getState().selection
      const activeNoteEditor = useReaderState.getState().noteEditorRange
      if (isSelectionIdea(currentSelection, activeNoteEditor, annotations?.data, publicMarkers)) {
        return
      }
      clearReaderSelection(rendererRef.current)
    }
    containerEl.addEventListener('content-click', handler)
    return () => {
      containerEl.removeEventListener('content-click', handler)
      if (annotationClickTimerRef.current) clearTimeout(annotationClickTimerRef.current)
    }
  }, [containerEl, setSelection, annotations?.data, publicMarkers])

  // While a floating UI is open (selection bubble / note editor / settings
  // popover), the click that dismisses it must not also turn a page or toggle
  // chrome — the renderer swallows click-to-turn while the guard is held
  const isFloatingSelection = Boolean(selection && (!isIdeaSidebarOpen || !selection.isIdea))
  const popupOpen = isFloatingSelection || settingsOpen || ttsOpen || autoReadingOpen || !!footnoteEntry
  useEffect(() => {
    if (!popupOpen || !renderer) return
    renderer.pushPopupGuard()
    return () => renderer.popPopupGuard()
  }, [popupOpen, renderer])

  // Dismiss popups on scroll (scrolled mode), but keep ideas open for side-by-side reading
  useEffect(() => {
    if (!containerEl) return
    const onScroll = () => {
      if (annotationClickHandledRef.current) return
      const currentSelection = useReaderState.getState().selection
      const activeNoteEditor = useReaderState.getState().noteEditorRange
      if (!isSelectionIdea(currentSelection, activeNoteEditor, annotations?.data, publicMarkers)) {
        clearReaderSelection(rendererRef.current)
      }
    }
    containerEl.addEventListener('scroll', onScroll, { passive: true })
    return () => containerEl.removeEventListener('scroll', onScroll)
  }, [containerEl, setSelection, annotations?.data, publicMarkers])

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
  // (sidebar toggle/drag, window resize), so dismiss a bare selection bubble
  // instead of leaving it floating at the old position. Modal dialogs like
  // IdeaOverlay and NoteEditorPopup are centered/anchored views and should not
  // be dismissed just because the sidebar opened or closed.
  useEffect(() => {
    if (!containerEl || typeof ResizeObserver === 'undefined') return
    let width = containerEl.clientWidth
    let height = containerEl.clientHeight
    const ro = new ResizeObserver(() => {
      if (containerEl.clientWidth === width && containerEl.clientHeight === height) return
      width = containerEl.clientWidth
      height = containerEl.clientHeight
      const currentSelection = useReaderState.getState().selection
      const activeNoteEditor = useReaderState.getState().noteEditorRange
      if (isSelectionIdea(currentSelection, activeNoteEditor, annotations?.data, publicMarkers)) return
      if (annotationClickHandledRef.current) {
        const nextRect = rendererRef.current?.getActiveAnnotationRect?.(currentSelection?.cfiRange)
        if (nextRect && currentSelection) {
          setSelection({
            ...currentSelection,
            rect: nextRect,
          })
        }
        return
      }
      clearReaderSelection(rendererRef.current)
    })
    ro.observe(containerEl)
    return () => ro.disconnect()
  }, [containerEl, setSelection, annotations?.data, publicMarkers])

  // Stable context value: a fresh `{ renderer }` object per render would
  // re-render every consumer on each relocate tick, defeating memo below
  const rendererContextValue = useMemo(() => ({ renderer }), [renderer])

  const handleMarkFinished = useCallback(async () => {
    flushReadingTimer()
    if (!isGuest) {
      try {
        await readingRoundMutation.mutateAsync('finish')
        notify.success({ key: 'reader.markedAsFinished' })
      } catch (err) {
        notify.error(getUserErrorNotification(err, 'errors.saveFailed'))
      }
    } else {
      notify.success({ key: 'reader.markedAsFinished' })
    }
  }, [flushReadingTimer, isGuest, readingRoundMutation])

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
    setAutoReadingOpen(false)
    clearReaderSelection(rendererRef.current)
    setSettingsOpen((v) => !v)
  }, [setSidebarOpen, toolbarLocked])

  const onToggleTts = useCallback(() => {
    setSettingsOpen(false)
    setAutoReadingOpen(false)
    clearReaderSelection(rendererRef.current)
    setTtsOpen((v) => !v)
  }, [])

  const onToggleAutoReading = useCallback(() => {
    setSettingsOpen(false)
    setTtsOpen(false)
    clearReaderSelection(rendererRef.current)
    setAutoReadingOpen((v) => !v)
  }, [])

  // Starting playback means eyes on the text: starting from either panel drops
  // a pinned chrome along with the popover and retracts the header so the view
  // is immediately clean.
  const onAutoReadingStart = useCallback(() => {
    keepChromePinnedRef.current = false
    setChromePinned(false)
    setHeaderSummon(false)
    if (headerLeaveTimerRef.current) {
      clearTimeout(headerLeaveTimerRef.current)
      headerLeaveTimerRef.current = null
    }
    setAutoReadingOpen(false)
  }, [])

  const onTtsStart = useCallback(() => {
    keepChromePinnedRef.current = false
    setChromePinned(false)
    setHeaderSummon(false)
    if (headerLeaveTimerRef.current) {
      clearTimeout(headerLeaveTimerRef.current)
      headerLeaveTimerRef.current = null
    }
    setTtsOpen(false)
  }, [])

  const onToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen()
    } else {
      void document.exitFullscreen()
    }
  }, [])

  const onAddBookmark = useCallback(async () => {
    if (revisionQuarantinedRef.current || !displayedRevisionId) return
    const bookmarkCfi = currentContentCfi
    if (!bookmarkCfi) return
    if (currentBookmark) {
      try {
        await deleteAnnotation.mutateAsync(currentBookmark.id)
        notify.success({ key: 'reader.bookmarkRemoved' })
      } catch (err) {
        notify.error(getUserErrorNotification(err, 'reader.bookmarkFailed'))
      }
      return
    }
    // Mid-jump the committed chapter/CFI don't belong to the same position
    // yet — ignore the press until relocate lands the destination
    if (navInFlightRef.current) return
    try {
      const snippet = rendererRef.current?.getSnippet?.(bookmarkCfi, BOOKMARK_CONTEXT_MAX_LENGTH)
      await createAnnotation.mutateAsync({
        cfiRange: bookmarkCfi,
        cfiAnchor: bookmarkCfi,
        type: 'bookmark',
        revisionId: displayedRevisionId ?? undefined,
        text: Array.from(snippet?.split(/\n/).find((line) => line.trim())?.trim() || currentChapter || _('reader.bookmark')).slice(0, 40).join(''),
        contextText: snippet || undefined,
        chapter: currentChapter ?? undefined,
        ...(currentChapterHref ? { chapterHref: currentChapterHref } : {}),
      })
      notify.success({ key: 'reader.bookmarkAdded' })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'reader.bookmarkFailed'))
    }
  }, [displayedRevisionId, currentBookmark, currentChapter, currentChapterHref, currentContentCfi, createAnnotation, deleteAnnotation, _])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isBookSearchInput = target.matches('[data-reader-book-search]')
      const shortcuts = readReaderShortcuts(useAuthStore.getState().user?.id ?? null)
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // A focused input's own Esc handler (or a window-level popup handler)
        // marks the consumed flag synchronously. Consume it in the next tick so
        // a stale mark cannot swallow the boss key on the following press.
        if (e.key === 'Escape') {
          setTimeout(() => {
            consumeEscFlag()
          }, 0)
        }
        if (!isBookSearchInput || e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229 || !shortcutMatches(e, shortcuts.search)) return
      }
      if (e.defaultPrevented && e.key !== 'Escape') return
      if (e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229) return
      const state = useReaderState.getState()
      const ui = useUiStore.getState()
      const inReaderInput = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
      const modal = isReaderModalOpen()
      const shortcutModal = isReaderShortcutModalOpen()
      const run = (id: keyof typeof shortcuts, action: () => void) => {
        if (inReaderInput && !(id === 'search' && isBookSearchInput)) return false
        if (!shortcutMatches(e, shortcuts[id])) return false
        e.preventDefault()
        e.stopPropagation()
        action()
        return true
      }
      if ((!modal || shortcutModal) && run('shortcutsMenu', () => {
        if (shortcutModal) {
          setShortcutDialogOpen(false)
          window.dispatchEvent(new Event('bd-reader-shortcuts-close'))
        } else {
          setShortcutDialogOpen(true)
        }
      })) return
      if (!modal) {
        if (run('sidebar', () => {
          if (state.sidebarOpen) state.setSidebarOpen(false)
          else {
            const remembered = ui.navTabRemembered
            state.setActiveNavTab(isGuest && remembered !== 'toc' ? 'toc' : remembered)
            state.setSidebarOpen(true)
          }
        })) return
        if (run('toc', () => { const closing = state.sidebarOpen && state.activeNavTab === 'toc'; if (!closing) { state.setActiveNavTab('toc'); ui.setNavTabRemembered('toc') }; state.setSidebarOpen(!closing) })) return
        if (run('notes', () => { const closing = state.sidebarOpen && state.activeNavTab === 'notes'; if (!closing) { state.setActiveNavTab('notes'); ui.setNavTabRemembered('notes') }; state.setSidebarOpen(!closing) })) return
        if (run('settings', onToggleSettings)) return
        if (run('fontIncrease', () => {
          const next = Math.min(64, effectiveSettings.fontSize + 1)
          if (next !== effectiveSettings.fontSize) updateSetting('fontSize', next)
        })) return
        if (run('fontDecrease', () => {
          const next = Math.max(12, effectiveSettings.fontSize - 1)
          if (next !== effectiveSettings.fontSize) updateSetting('fontSize', next)
        })) return
        if (run('search', () => {
          state.setActiveNavTab('toc')
          ui.setNavTabRemembered('toc')
          state.setSidebarOpen(true)
          window.setTimeout(() => window.dispatchEvent(new CustomEvent('bd-reader-search')), 0)
        })) return
        if (run('historyBack', onHistoryBack)) return
        if (run('historyForward', onHistoryForward)) return
        if (run('tts', () => playbackCoordinator.command('tts'))) return
        if (run('autoReading', () => playbackCoordinator.command('auto'))) return
        const isReadingBody = isReaderContentTarget(e.target, containerEl)
        if (isReadingBody && run('chapterStart', () => {
          if (currentChapterIndex != null) void rendererRef.current?.display(`chapter:${currentChapterIndex}:0`)
        })) return
        if (isReadingBody && run('chapterEnd', () => {
          if (currentChapterIndex != null) void rendererRef.current?.display(`chapter:${currentChapterIndex}:1`)
        })) return
      }
      if (e.key === 'Escape') {
        // Boss key: popups mark the consumed flag synchronously in their own
        // Esc branches; listeners run in registration order (ours first), so
        // defer the decision and exit the reader only when nothing else
        // handled the press. Progress is flushed on unmount.
        setTimeout(() => {
          if (e.defaultPrevented || consumeEscFlag()) return
          if (useReaderState.getState().selection && !useReaderState.getState().noteEditorRange) {
            clearReaderSelection(rendererRef.current)
            return
          }
          navigate({ to: '/' })
        }, 0)
        return
      }
      if (e.key === ' ') {
        // Space is a playback and chrome key, never a page turn. Paging is the
        // arrows' job: a space press is unpredictable enough that a reader
        // cannot tell in advance whether it will move the text, and in scrolled
        // mode the browser's native space-scroll would move it anyway.
        // Ctrl/Alt/Meta are left alone so the IME toggle (Ctrl+Space),
        // the window menu (Alt+Space) and the macOS input switcher
        // (Cmd+Space) still reach the system.
        if (e.ctrlKey || e.altKey || e.metaKey) return
        if (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button') return
        e.preventDefault()
        if (playbackCoordinator.canToggle()) playbackCoordinator.toggle()
        else toggleChrome()
        return
      }
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      if (e.key === 'ArrowLeft' || (readingMode === 'page' && e.key === 'ArrowUp')) {
        e.preventDefault()
        if (readingMode === 'page' && rendererRef.current?.scrollByPages) {
          void rendererRef.current.scrollByPages(-1)
        } else {
          void rendererRef.current?.prev()
        }
      } else if (e.key === 'ArrowRight' || (readingMode === 'page' && e.key === 'ArrowDown')) {
        e.preventDefault()
        if (readingMode === 'page' && rendererRef.current?.scrollByPages) {
          void rendererRef.current.scrollByPages(1)
        } else {
          void rendererRef.current?.next()
        }
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        // scroll mode: one screen per key (0.92 viewport overlap, same as the
        // bottom-bar buttons); page mode: PageUp/Down turn pages like the
        // in-iframe handler. Handled here so keys keep working after a keyboard
        // chapter switch drops focus to body.
        e.preventDefault()
        const dir = (e.key === 'ArrowDown' || e.key === 'PageDown') ? 1 : -1
        void rendererRef.current?.scrollByPages(dir)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playbackCoordinator, readingMode, navigate, toggleChrome, isGuest, onToggleSettings, onHistoryBack, onHistoryForward, currentChapterIndex, containerEl, effectiveSettings.fontSize, updateSetting])

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
          <ReaderLoadingBadge />
        </div>
      </div>
    )
  }

  if (bookQuery.isError) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4" style={{ backgroundColor: 'var(--bd-read-page-bg)', color: 'var(--bd-read-text)' }}>
        <div ref={containerCallbackRef} />
        <div className="flex max-w-sm flex-col items-center gap-3.5 rounded-2xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)]/95 p-6 text-center shadow-xl backdrop-blur-md">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-500 dark:bg-red-500/20" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <span className="text-sm font-medium text-red-500">{getUserErrorMessage(bookQuery.error, _, 'errors.loadFailed')}</span>
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={bookQuery.isFetching}
              onClick={() => void bookQuery.refetch()}
            >
              {bookQuery.isFetching ? _('errors.retrying') : _('errors.retry')}
            </Button>
            <Link to="/">
              <Button type="button" variant="primary" size="sm">
                {_('errors.backToLibrary')}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!bookQuery.data?.data) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4" style={{ backgroundColor: 'var(--bd-read-page-bg)', color: 'var(--bd-read-text)' }}>
        <div ref={containerCallbackRef} />
        <div className="flex max-w-sm flex-col items-center gap-3.5 rounded-2xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)]/95 p-6 text-center shadow-xl backdrop-blur-md">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-stone-500/10 text-[var(--bd-read-sub)]" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </div>
          <span className="text-sm text-[var(--bd-read-sub)]">{_('reader.notFound')}</span>
          <Link to="/" className="pt-1">
            <Button type="button" variant="primary" size="sm">
              {_('errors.backToLibrary')}
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  const book = bookQuery.data.data

  return (
    <ErrorBoundary>
      <ViewSettingsContext.Provider value={viewSettingsContextValue}>
      <DialogLayoutContext.Provider value={dialogInset}>
      <RendererContext.Provider value={rendererContextValue}>
      <AutoReadingSessionProvider renderer={renderer} coordinator={playbackCoordinator} onStart={onAutoReadingStart}>
      <TtsSessionProvider renderer={renderer} coordinator={playbackCoordinator} guestReadOnly={isGuest} onStart={onTtsStart}>
      <div className="fixed inset-0 z-30" style={{ backgroundColor: 'var(--bd-read-page-bg)', color: 'var(--bd-read-text)' }}>
        <div className="flex h-full w-full">
            <ReaderSidebar
              bookId={id}
              onStatsTabOpen={flushReadingTimer}
              chromePinned={chromePinned}
              footerVisible={footerVisible}
              mobileDockVisible={mobileDockVisible}
              onFooterSummon={onFooterEnter}
              guestReadOnly={isGuest}
            />
          <div
            data-reader-canvas
            className="relative flex flex-1 flex-col transition-[margin] duration-150 will-change-[margin]"
            style={{
              marginRight: isIdeaSidebarOpen ? `${ideaSidebarWidth}px` : undefined,
            }}
          >
            {/* Top controls float over the reader; desktop summoning follows pointer position. */}
            <div className="absolute inset-x-0 top-0 z-50 pointer-events-none">
              <div
                className={cn('absolute inset-x-0 top-0', headerVisible ? 'pointer-events-auto' : 'pointer-events-none')}
                onPointerEnter={isTouch ? undefined : onHeaderEnter}
                onPointerLeave={isTouch ? undefined : onHeaderLeave}
              >
                <ReaderHeader
                  title={pendingNavChapter || currentChapter || book.title}
                  visible={headerVisible}
                  pinned={chromePinned}
                  settingsOpen={settingsOpen}
                  ttsOpen={ttsOpen}
                  autoReadingOpen={autoReadingOpen}
                  readingMode={readingMode}
                  bookId={id}
                  cleanReadingSupported={cleanReadingSupported}
                  estimatedMinutes={estimatedMinutes}
                  onAddBookmark={isGuest ? undefined : onAddBookmark}
                  onToggleSettings={onToggleSettings}
                  onCloseSettings={() => setSettingsOpen(false)}
                  onCloseTts={() => setTtsOpen(false)}
                  onCloseAutoReading={() => setAutoReadingOpen(false)}
                  onToggleTts={isGuest ? undefined : onToggleTts}
                  onToggleAutoReading={onToggleAutoReading}
                  onTtsStart={onTtsStart}
                  onAutoReadingStart={onAutoReadingStart}
                  onToggleFullscreen={onToggleFullscreen}
                  bookmarkActive={!isGuest && !!currentBookmark}
                />
              </div>
            </div>
            <Ribbon visible={!!currentBookmark} />
            <div
              ref={containerCallbackRef}
              data-reader-viewport
              onPointerDown={() => {
                setCornerDwell(false)
              }}
              className={cn(
                'flex-1',
                readingMode === 'page' ? 'overflow-hidden' : 'overflow-y-auto',
                isTouch && readingMode === 'scroll' && mobileDockVisible && footerVisible && 'pb-[calc(6.5rem+2*env(safe-area-inset-bottom))]',
                isTouch && readingMode === 'scroll' && mobileDockVisible && !footerVisible && 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]',
                isTouch && readingMode === 'scroll' && !mobileDockVisible && footerVisible && 'pb-[calc(3rem+env(safe-area-inset-bottom))]',
              )}
            />
            <AutoReadingProgressBar readingMode={readingMode} />
            {endOfBookMount && createPortal(
              <EndOfBookView
                bookId={id}
                bookTitle={book.title}
                readStatus={book.readStatus}
                guestReadOnly={isGuest}
                onMarkFinished={handleMarkFinished}
                isMarkingFinished={readingRoundMutation.isPending}
              />,
              endOfBookMount
            )}
            {navPending && (
              <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                <ReaderLoadingBadge />
              </div>
            )}
            {readerReady && navError && (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 justify-center px-4">
                <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-2.5 rounded-2xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)]/95 px-5 py-4 text-center text-sm shadow-xl backdrop-blur-md">
                  <span className="font-medium text-red-500">
                    {navError.chapter ? `${navError.chapter}：` : ''}{_('reader.navigationLoadFailed')}
                  </span>
                  <span className="text-xs text-[var(--bd-read-sub)]">{_('reader.navigationLoadHint')}</span>
                  {navError.target && (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      className="mt-1"
                      onClick={() => {
                        const target = navError.target
                        setNavError(null)
                        void renderer?.display(target)
                      }}
                    >
                      {_('reader.retry')}
                    </Button>
                  )}
                </div>
              </div>
            )}
            {!readerReady && (
              // Solid theme background: the foliate iframe behind is blank
              // white until its theme styles are injected — without this the
              // loading overlay would flash white on every reader open
              <div data-testid="reader-loading-surface" className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[var(--bd-read-page-bg)] text-sm text-[var(--bd-read-sub)]">
                {settingsFailed || preparationFailed ? (
                  <div className="pointer-events-auto flex flex-col items-center gap-3">
                    <span>{_('errors.loadFailed')}</span>
                    <Button onClick={() => {
                      void queryClient.refetchQueries({ queryKey: ['settings'] })
                      void retryPreparation?.()
                    }}>{_('reader.retry')}</Button>
                  </div>
                ) : progressQuery.isError && initialCfiRef.current === undefined && !progressStartOver ? (
                  <div className="flex max-w-sm flex-col items-center gap-3.5 rounded-2xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)]/95 p-6 text-center shadow-xl backdrop-blur-md">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-500 dark:bg-red-500/20" aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </div>
                    <span className="font-medium text-red-500">{_('reader.progressLoadFailed')}</span>
                    <p className="max-w-xs text-center text-xs text-[var(--bd-read-sub)]">{_('reader.progressLoadHint')}</p>
                    <div className="pointer-events-auto mt-2 flex flex-wrap items-center justify-center gap-2">
                      <Link to="/">
                        <Button type="button" variant="secondary" size="sm">
                          {_('reader.back')}
                        </Button>
                      </Link>
                      {/* Explicit user choice: starting over may overwrite the saved position */}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          initialCfiRef.current = ''
                          initialFractionRef.current = undefined
                          restoreGateRef.current?.open()
                          setProgressStartOver(true)
                        }}
                      >
                        {_('reader.progressStartOver')}
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => void progressQuery.refetch()}
                      >
                        {_('reader.progressRetry')}
                      </Button>
                    </div>
                  </div>
                ) : loadError ? (
                  <div className="flex max-w-sm flex-col items-center gap-3.5 rounded-2xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)]/95 p-6 text-center shadow-xl backdrop-blur-md">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-500 dark:bg-red-500/20" aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </div>
                    <span className="font-medium text-red-500">{_('reader.bookLoadParseFailed')}</span>
                    <p className="max-w-xs text-center text-xs text-[var(--bd-read-sub)]">
                      {_('reader.bookLoadFileHint')}
                    </p>
                    <div className="pointer-events-auto mt-2 flex items-center justify-center gap-2">
                      <Link to="/">
                        <Button type="button" variant="secondary" size="sm">
                          {_('reader.back')}
                        </Button>
                      </Link>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => window.location.reload()}
                      >
                        {_('reader.refresh')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <ReaderLoadingBadge />
                    {slowLoad && (
                      <span className="text-xs text-[var(--bd-read-sub)] opacity-70 transition-opacity">
                        {_('reader.bookLoadSlow')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* Bottom controls float over the reader; desktop summoning follows pointer position.
                Capsules retain their own small interactive hit areas.
                Touch: summon/dwell stay inert (no sticky hover, no tap
                interception); the footer follows chromePinned alone. The
                mobile tool dock occupies the row below this progress strip. */}
            <div className="absolute inset-x-0 bottom-0 z-40 pointer-events-none">
              <div
                data-toast-obstacle={footerVisible && !isSelectingText ? '' : undefined}
                className={cn('absolute inset-x-0 bottom-0', footerVisible && !isSelectingText ? 'pointer-events-auto' : 'pointer-events-none')}
                onPointerEnter={isTouch || isSelectingText ? undefined : onFooterEnter}
                onPointerLeave={isTouch ? undefined : onFooterLeave}
              >
                <ProgressStrip
                  percent={percent}
                  pageInfo={pageInfo ?? undefined}
                  visible={footerVisible}
                  pinned={chromePinned}
                  mobileDockVisible={mobileDockVisible}
                  chapters={chaptersQuery.data?.data}
                  sectionFractions={sectionFractions}
                  sectionTocLabels={sectionTocLabels}
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
                    'pointer-events-none absolute left-0 z-[60] h-24 w-28 transition-[bottom,translate] duration-300',
                    mobileDockVisible
                      ? 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]'
                      : 'bottom-0',
                    footerVisible
                      ? '-translate-y-12'
                      : 'translate-y-full pointer-events-none',
                  )}
                >
                  <HistoryCapsule
                    canBack={historyCaps.canBack}
                    canForward={historyCaps.canForward}
                    onBack={onHistoryBack}
                    onForward={onHistoryForward}
                    onPointerEnter={isTouch ? undefined : () => setCornerDwell(true)}
                    onPointerLeave={isTouch ? undefined : () => setCornerDwell(false)}
                  />
                </div>
              )}
              <ReaderFooterControls
                bookId={id}
                coordinator={playbackCoordinator}
                footerVisible={footerVisible}
                isTouch={isTouch}
                mobileDockVisible={mobileDockVisible}
                onPointerEnter={() => setCornerDwell(true)}
                onPointerLeave={() => setCornerDwell(false)}
                readingTimerMode={isGuest ? 'off' : readingTimerMode}
              />
            </div>
          </div>
        </div>
        <ContentUpdateNotice bookId={id} book={bookQuery.isFetchedAfterMount && bookQuery.data?.data ? { ...bookQuery.data.data, revisionId: displayedRevisionId ?? bookQuery.data.data.revisionId } : undefined} ready={readerReady} guest={isGuest} />
        {!isGuest && !revisionQuarantined && displayedRevisionId && <SelectionToolbar bookId={id} revisionId={displayedRevisionId} fontStack={fontStack} fontCss={fontCss} />}
        {footnoteEntry && (
          <FootnotePopup
            entry={footnoteEntry}
            onBack={() => rendererRef.current?.backFootnote()}
            onClose={() => rendererRef.current?.closeFootnote()}
          />
        )}
        <ShareCardDialog bookId={id} />
        {replaceTarget && (
          <Modal
            title={_('annotation.replaceSelection')}
            onClose={() => setReplaceTarget(null)}
            containerProps={{ 'data-reader-modal': '' }}
          >
            <ReplacementForm
              bookId={id}
              selection={replaceTarget}
              onDone={() => setReplaceTarget(null)}
            />
          </Modal>
        )}
        {imageViewer && (
          <ImageViewer
            image={imageViewer}
            bookTitle={bookQuery.data?.data?.title}
            onClose={() => setImageViewer(null)}
          />
        )}
        {imageContextMenu && (
          <ImageContextMenu
            image={imageContextMenu}
            bookTitle={bookQuery.data?.data?.title}
            onClose={() => setImageContextMenu(null)}
            onView={(info) => {
              setImageContextMenu(null)
              setImageViewer(info)
            }}
          />
        )}
        {shortcutDialogOpen && <ReaderKeyboardShortcuts onClose={() => setShortcutDialogOpen(false)} />}
      </div>
      </TtsSessionProvider>
      </AutoReadingSessionProvider>
      </RendererContext.Provider>
      </DialogLayoutContext.Provider>
    </ViewSettingsContext.Provider>
    </ErrorBoundary>
  )
}
