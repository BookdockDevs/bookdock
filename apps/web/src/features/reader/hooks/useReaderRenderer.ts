import { useEffect, useMemo, useRef, useCallback, useState } from 'react'
import type { BookFormat } from '@bookdock/shared'

import { selectEffectiveReadingThemeId, useUiStore } from '@/stores/ui.store'
import { useFonts } from '@/api/hooks/useFonts'
import { resolveReadingTheme } from '@/lib/reading-theme'
import { FoliateReader } from '../renderers/FoliateReader'
import { resolveDualFont } from '../fonts'
import type { BookReader, ClickAreaMode, MarginalField, RendererEvents } from '../types'
import type { EffectiveViewSettings } from '../lib/view-settings'

interface UseReaderRendererOptions {
  ready?: boolean
  url: string
  mountGeneration?: number
  bookId?: string
  format?: BookFormat
  /** Known file size from the book-detail response; lets the renderer pick
   *  the zip load strategy without a HEAD probe. */
  bookSize?: number
  initialCfi?: string
  /** Fallback start position (0-1): used when no CFI was saved (stale after
   *  a re-TOC) and when the saved CFI fails to resolve (renderer falls back
   *  to fraction navigation instead of leaving the view at the book start). */
  initialFraction?: number
  /** Per-book merged values for the first-batch settings (F1). When omitted,
   *  the global store values are used. */
  settings?: EffectiveViewSettings
  /** Per-chapter word counts, indexed by chapter (info-bar word count field) */
  chapterWordCounts?: (number | undefined)[]
  /** Returns a user navigation target queued before the renderer became visible. */
  onReady?: () => string | undefined
  onRelocated?: (e: Parameters<RendererEvents['relocated']>[0]) => void
  onSelected?: (e: Parameters<RendererEvents['selected']>[0]) => void
  onTextSelectionStart?: () => void
  onAnnotationClicked?: (e: Parameters<RendererEvents['annotationClicked']>[0]) => void
  onImageClicked?: (e: Parameters<RendererEvents['imageClicked']>[0]) => void
  onImageContextMenu?: (e: Parameters<RendererEvents['imageContextMenu']>[0]) => void
  onMediaError?: (e: Parameters<RendererEvents['mediaError']>[0]) => void
  onMediaPlay?: (e: Parameters<RendererEvents['mediaPlay']>[0]) => void
  onInstantAnnotation?: (e: Parameters<RendererEvents['instantAnnotation']>[0]) => void
  onRendered?: (url: string) => void
  onFontFallback?: () => void
  /** The view is torn down and rebuilt; the host must cover the reading area. */
  onViewRebuilding?: (pending: boolean) => void
  onError?: (err: Error) => void
  onTocReady?: (items: { label: string; href: string; level?: number }[]) => void
  onJumpConfirmed?: (e: { cfi: string }) => void
  onNavigatePending?: (e: Parameters<RendererEvents['navigatePending']>[0]) => void
  onRevisionNavigation?: (e: Parameters<RendererEvents['revisionNavigation']>[0]) => void
  onRevisionChanged?: (e: Parameters<RendererEvents['revisionChanged']>[0]) => void
  onNavigateError?: (e: Parameters<RendererEvents['navigateError']>[0]) => void
  onChromeToggle?: () => void
  onUserJump?: () => void
  onReplacementInvalid?: (e: Parameters<RendererEvents['replacementInvalid']>[0]) => void
  onAnnotationOrphaned?: (e: Parameters<RendererEvents['annotationOrphaned']>[0]) => void
  onFootnoteOpen?: (e: Parameters<RendererEvents['footnoteOpen']>[0]) => void
  onFootnoteClose?: () => void
}

interface RendererMount {
  renderer: BookReader
  host: HTMLDivElement
  bookId: string | undefined
  url: string
  mountGeneration: number
  dispose: () => void
}

export function useReaderRenderer({
  ready = true,
  url,
  mountGeneration = 0,
  bookId,
  format,
  bookSize,
  initialCfi,
  initialFraction,
  settings,
  chapterWordCounts,
  onReady,
  onRelocated,
  onSelected,
  onTextSelectionStart,
  onAnnotationClicked,
  onImageClicked,
  onImageContextMenu,
  onMediaError,
  onMediaPlay,
  onInstantAnnotation,
  onRendered,
  onFontFallback,
  onViewRebuilding,
  onError,
  onTocReady,
  onJumpConfirmed,
  onNavigatePending,
  onRevisionNavigation,
  onRevisionChanged,
  onNavigateError,
  onChromeToggle,
  onUserJump,
  onReplacementInvalid,
  onAnnotationOrphaned,
  onFootnoteOpen,
  onFootnoteClose,
}: UseReaderRendererOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<BookReader | null>(null)
  const activeMountRef = useRef<RendererMount | null>(null)
  const desiredUrlRef = useRef(url)
  const desiredBookIdRef = useRef(bookId)
  const desiredMountGenerationRef = useRef(mountGeneration)
  desiredUrlRef.current = url
  desiredBookIdRef.current = bookId
  desiredMountGenerationRef.current = mountGeneration
  const [renderer, setRenderer] = useState<BookReader | null>(null)
  const remountPositionRef = useRef<{ key: string; cfi: string | null; fraction: number | null } | null>(null)

  const readingThemeId = useUiStore(selectEffectiveReadingThemeId)
  const customThemes = useUiStore((s) => s.customThemes)
  const fontFamily = useUiStore((s) => s.fontFamily)
  const cjkFontFamily = useUiStore((s) => s.cjkFontFamily)
  const fontPreferences = useUiStore((s) => s.fontPreferences)
  const fontOrder = useUiStore((s) => s.fontOrder)
  const storeFontSize = useUiStore((s) => s.fontSize)
  const storeCleanReading = useUiStore((s) => s.cleanReading)
  const fontWeight = useUiStore((s) => s.fontWeight)
  const storeLineHeight = useUiStore((s) => s.lineHeight)
  const paragraphSpacing = useUiStore((s) => s.paragraphSpacing)
  const chapterTitleAlign = useUiStore((s) => s.chapterTitleAlign)
  const chapterTitleSize = useUiStore((s) => s.chapterTitleSize)
  const chapterTitleTopSpacing = useUiStore((s) => s.chapterTitleTopSpacing)
  const chapterTitleBottomSpacing = useUiStore((s) => s.chapterTitleBottomSpacing)
  const letterSpacing = useUiStore((s) => s.letterSpacing)
  const indent = useUiStore((s) => s.indent)
  const storePageWidth = useUiStore((s) => s.pageWidth)
  const storeVerticalPadding = useUiStore((s) => s.verticalPadding)
  const storeHorizontalPadding = useUiStore((s) => s.horizontalPadding)
  const textAlignJustify = useUiStore((s) => s.textAlignJustify)
  const overrideBookFont = useUiStore((s) => s.overrideBookFont)
  const overrideBookLayout = useUiStore((s) => s.overrideBookLayout)
  const readingMode = useUiStore((s) => s.readingMode)
  const storePageColumns = useUiStore((s) => s.pageColumns)
  const storeColumnGap = useUiStore((s) => s.columnGap)
  const chineseConversion = useUiStore((s) => s.chineseConversion)
  const continuousScroll = useUiStore((s) => s.continuousScroll)
  const pageAnimation = useUiStore((s) => s.pageAnimation)
  const showHeader = useUiStore((s) => s.showHeader)
  const showFooter = useUiStore((s) => s.showFooter)
  const clickAreaMode = useUiStore((s) => s.clickAreaMode)
  const headerLeft = useUiStore((s) => s.headerLeft)
  const headerCenter = useUiStore((s) => s.headerCenter)
  const headerRight = useUiStore((s) => s.headerRight)
  const footerLeft = useUiStore((s) => s.footerLeft)
  const footerCenter = useUiStore((s) => s.footerCenter)
  const footerRight = useUiStore((s) => s.footerRight)
  const marginalFontSize = useUiStore((s) => s.marginalFontSize)

  // Per-book overrides (F1) take precedence over the global store for the
  // first-batch keys; everything else keeps reading the store directly.
  const fontSize = settings?.fontSize ?? storeFontSize
  const cleanReading = settings?.cleanReading ?? storeCleanReading
  const lineHeight = settings?.lineHeight ?? storeLineHeight
  const pageWidth = settings?.pageWidth ?? storePageWidth
  const verticalPadding = settings?.verticalPadding ?? storeVerticalPadding
  const horizontalPadding = settings?.horizontalPadding ?? storeHorizontalPadding
  const pageColumns = settings?.pageColumns ?? storePageColumns
  const columnGap = settings?.columnGap ?? storeColumnGap

  // Registry resolution lives at this boundary: the renderer only ever
  // receives a concrete stack + optional @font-face/@import css. While the
  // fonts query is still loading an uploaded id resolves to the system
  // fallback; fontCss changing re-triggers the applyFont effect below.
  const fontsQuery = useFonts()
  const fontsData = fontsQuery.data
  const preparedUrlRef = useRef('')
  if (!url || !ready) {
    preparedUrlRef.current = ''
  } else if (fontsData) {
    preparedUrlRef.current = url
  }
  const canMount = Boolean(url) && ready && preparedUrlRef.current === url
  const resolvedFont = resolveDualFont(fontFamily, cjkFontFamily, fontsData?.data ?? [], fontPreferences, fontOrder)
  const fontStack = resolvedFont.stack
  const fontCss = resolvedFont.css

  const onRelocatedRef = useRef(onRelocated)
  const onReadyRef = useRef(onReady)
  const onSelectedRef = useRef(onSelected)
  const onTextSelectionStartRef = useRef(onTextSelectionStart)
  const onAnnotationClickedRef = useRef(onAnnotationClicked)
  const onImageClickedRef = useRef(onImageClicked)
  const onImageContextMenuRef = useRef(onImageContextMenu)
  const onMediaErrorRef = useRef(onMediaError)
  const onMediaPlayRef = useRef(onMediaPlay)
  const onInstantAnnotationRef = useRef(onInstantAnnotation)
  const onRenderedRef = useRef(onRendered)
  const onFontFallbackRef = useRef(onFontFallback)
  const onViewRebuildingRef = useRef(onViewRebuilding)
  const onErrorRef = useRef(onError)
  const onTocReadyRef = useRef(onTocReady)
  const onJumpConfirmedRef = useRef(onJumpConfirmed)
  const onNavigatePendingRef = useRef(onNavigatePending)
  const onRevisionNavigationRef = useRef(onRevisionNavigation)
  const onRevisionChangedRef = useRef(onRevisionChanged)
  const onNavigateErrorRef = useRef(onNavigateError)
  const onChromeToggleRef = useRef(onChromeToggle)
  const onUserJumpRef = useRef(onUserJump)
  const onReplacementInvalidRef = useRef(onReplacementInvalid)
  const onAnnotationOrphanedRef = useRef(onAnnotationOrphaned)
  const onFootnoteOpenRef = useRef(onFootnoteOpen)
  const onFootnoteCloseRef = useRef(onFootnoteClose)
  const theme = useMemo(() => resolveReadingTheme(readingThemeId, customThemes), [readingThemeId, customThemes])
  const themeRef = useRef(theme)
  const fontRef = useRef({ fontFamily, cjkFontFamily, fontStack, fontCss, size: fontSize, lineHeight, fontWeight, overrideBookFont })
  const paragraphRef = useRef({ paragraphSpacing, chapterTitleAlign, chapterTitleSize, chapterTitleTopSpacing, chapterTitleBottomSpacing, letterSpacing, indent, verticalPadding, horizontalPadding, textAlignJustify, overrideBookLayout })
  const pageWidthRef = useRef(pageWidth)
  const chineseConversionRef = useRef(chineseConversion)
  const continuousScrollRef = useRef(continuousScroll)
  const readingModeRef = useRef(readingMode)
  const pageColumnsRef = useRef(pageColumns)
  const columnGapRef = useRef(columnGap)
  const pageAnimationRef = useRef(pageAnimation)
  const showHeaderRef = useRef(showHeader)
  const showFooterRef = useRef(showFooter)
  const clickAreaModeRef = useRef<ClickAreaMode>(clickAreaMode)
  const marginalConfigRef = useRef({
    header: [headerLeft, headerCenter, headerRight] as [MarginalField, MarginalField, MarginalField],
    footer: [footerLeft, footerCenter, footerRight] as [MarginalField, MarginalField, MarginalField],
    fontSize: marginalFontSize,
  })

  onRelocatedRef.current = onRelocated
  onReadyRef.current = onReady
  onSelectedRef.current = onSelected
  onTextSelectionStartRef.current = onTextSelectionStart
  onAnnotationClickedRef.current = onAnnotationClicked
  onImageClickedRef.current = onImageClicked
  onImageContextMenuRef.current = onImageContextMenu
  onMediaErrorRef.current = onMediaError
  onMediaPlayRef.current = onMediaPlay
  onInstantAnnotationRef.current = onInstantAnnotation
  onRenderedRef.current = onRendered
  onFontFallbackRef.current = onFontFallback
  onViewRebuildingRef.current = onViewRebuilding
  onErrorRef.current = onError
  onTocReadyRef.current = onTocReady
  onJumpConfirmedRef.current = onJumpConfirmed
  onNavigatePendingRef.current = onNavigatePending
  onRevisionNavigationRef.current = onRevisionNavigation
  onRevisionChangedRef.current = onRevisionChanged
  onNavigateErrorRef.current = onNavigateError
  onChromeToggleRef.current = onChromeToggle
  onUserJumpRef.current = onUserJump
  onReplacementInvalidRef.current = onReplacementInvalid
  onAnnotationOrphanedRef.current = onAnnotationOrphaned
  onFootnoteOpenRef.current = onFootnoteOpen
  onFootnoteCloseRef.current = onFootnoteClose
  themeRef.current = theme
  fontRef.current = { fontFamily, cjkFontFamily, fontStack, fontCss, size: fontSize, lineHeight, fontWeight, overrideBookFont }
  paragraphRef.current = { paragraphSpacing, chapterTitleAlign, chapterTitleSize, chapterTitleTopSpacing, chapterTitleBottomSpacing, letterSpacing, indent, verticalPadding, horizontalPadding, textAlignJustify, overrideBookLayout }
  pageWidthRef.current = pageWidth
  chineseConversionRef.current = chineseConversion
  continuousScrollRef.current = continuousScroll
  readingModeRef.current = readingMode
  pageColumnsRef.current = pageColumns
  columnGapRef.current = columnGap
  pageAnimationRef.current = pageAnimation
  showHeaderRef.current = showHeader
  showFooterRef.current = showFooter
  clickAreaModeRef.current = clickAreaMode
  marginalConfigRef.current = {
    header: [headerLeft, headerCenter, headerRight],
    footer: [footerLeft, footerCenter, footerRight],
    fontSize: marginalFontSize,
  }

  const createRenderer = useCallback(() => new FoliateReader(url, bookId, bookSize, format, cleanReading), [bookId, bookSize, cleanReading, format, url])

  useEffect(() => {
    if (!containerRef.current || !url || !canMount) return
    const activeMount = activeMountRef.current
    if (activeMount && activeMount.bookId === bookId && activeMount.url === url
      && activeMount.mountGeneration === mountGeneration
      && rendererRef.current === activeMount.renderer) {
      setRenderer(activeMount.renderer)
      requestAnimationFrame(() => onRenderedRef.current?.(url))
      return () => {
        if (activeMountRef.current?.renderer === activeMount.renderer
          && desiredBookIdRef.current === bookId
          && (desiredUrlRef.current !== url || desiredMountGenerationRef.current !== mountGeneration)) return
        activeMount.dispose()
        setRenderer((current) => (current === activeMount.renderer ? null : current))
      }
    }
    // Wait until the start position is known ('' means "no saved progress")
    // so mount navigates exactly once instead of goTo(0) then display(cfi).
    // Safe in deps: queries have staleTime Infinity, so initialCfi only
    // transitions undefined -> value once per book.
    if (initialCfi === undefined) return

    const currentMount = activeMountRef.current
    const previousMount = currentMount && currentMount.bookId === bookId
      && (currentMount.url !== url || currentMount.mountGeneration !== mountGeneration)
      ? currentMount
      : null
    const rendererKey = `${bookId ?? ''}\u0000${url}`
    const carriedPosition = remountPositionRef.current?.key === rendererKey
      ? remountPositionRef.current
      : null
    remountPositionRef.current = null
    const newRenderer = createRenderer()
    rendererRef.current = newRenderer
    const host = document.createElement('div')
    if (getComputedStyle(containerRef.current).position === 'static') containerRef.current.style.position = 'relative'
    host.style.position = 'absolute'
    host.style.inset = '0'
    host.style.visibility = previousMount ? 'hidden' : 'visible'
    containerRef.current.append(host)
    const theme = themeRef.current

    newRenderer.applyReadingMode(readingModeRef.current)
    newRenderer.applyPageColumns(pageColumnsRef.current)
    newRenderer.applyColumnGap(columnGapRef.current)
    newRenderer.applyPageAnimation(pageAnimationRef.current)
    newRenderer.applyShowHeader(showHeaderRef.current)
    newRenderer.applyShowFooter(showFooterRef.current)
    newRenderer.applyReadingTheme({ bg: theme.pageBg, text: theme.text, primary: theme.primary })
    newRenderer.applyFont(fontRef.current)
    newRenderer.applyParagraphStyle(paragraphRef.current)
    newRenderer.applyPageWidth(pageWidthRef.current)
    newRenderer.applyChineseConversion(chineseConversionRef.current)
    newRenderer.applyContinuousScroll(continuousScrollRef.current)
    newRenderer.applyClickSettings(clickAreaModeRef.current)
    newRenderer.applyMarginals(marginalConfigRef.current)

    let cancelled = false
    const isMountedRenderer = () => !cancelled && rendererRef.current === newRenderer
    const isCurrentRenderer = () => isMountedRenderer()
      && (!previousMount || activeMountRef.current?.renderer === newRenderer)
    let disposed = false
    let teardown = () => {}
    let stagedRelocated: Parameters<RendererEvents['relocated']>[0] | undefined
    let stagedToc: { label: string; href: string; level?: number }[] | undefined
    const mountRecord: RendererMount = {
      renderer: newRenderer,
      host,
      bookId,
      url,
      mountGeneration,
      dispose: () => {
        if (disposed) return
        disposed = true
        teardown()
        newRenderer.destroy()
        host.remove()
        if (activeMountRef.current?.renderer === newRenderer) activeMountRef.current = null
        if (rendererRef.current === newRenderer) rendererRef.current = null
      },
    }
    const initialTarget = carriedPosition?.cfi ?? initialCfi
    const initialPositionFraction = carriedPosition?.fraction ?? initialFraction
    // Fires once the view is live but BEFORE the initial chapter load resolves:
    // exposing the renderer here lets TOC jumps navigate immediately (a user
    // jump supersedes the in-flight open). Record the consumed startup input,
    // not the carried live position: the saved-position effect must not replay
    // an older startup CFI over a same-book rebuild or a user jump.
    const markReady = () => {
      if (!isMountedRenderer()) return undefined
      handledInitialCfiRef.current = initialCfi
      if (!previousMount) setRenderer(newRenderer)
      return onReadyRef.current?.()
    }
    newRenderer.mount(host, initialTarget, initialPositionFraction, markReady).then(async () => {
      // StrictMode double-invokes this effect: the loser must not become the
      // current renderer — its view already bailed out of mount
      if (!isMountedRenderer()) return
      // mount already navigated (initialTarget may be '' for "book start")
      handledInitialCfiRef.current = initialCfi
      if (!previousMount) setRenderer(newRenderer)
    }).catch((err) => {
      console.error('[FoliateReader] mount failed:', err)
      if (isMountedRenderer()) {
        if (previousMount) {
          previousMount.host.style.visibility = 'visible'
          activeMountRef.current = previousMount
          rendererRef.current = previousMount.renderer
          setRenderer(previousMount.renderer)
        }
        mountRecord.dispose()
        onViewRebuildingRef.current?.(false)
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)))
      }
    })

    const unsubRelocated = newRenderer.on('relocated', (e) => {
      if (!isMountedRenderer()) return
      if (previousMount && activeMountRef.current?.renderer !== newRenderer) stagedRelocated = e
      else onRelocatedRef.current?.(e)
    })
    const unsubSelected = newRenderer.on('selected', (e) => { if (isCurrentRenderer()) onSelectedRef.current?.(e) })
    const unsubTextSelectionStart = newRenderer.on('textSelectionStart', () => { if (isCurrentRenderer()) onTextSelectionStartRef.current?.() })
    const unsubAnnotationClicked = newRenderer.on('annotationClicked', (e) => { if (isCurrentRenderer()) onAnnotationClickedRef.current?.(e) })
    const unsubImageClicked = newRenderer.on('imageClicked', (e) => { if (isCurrentRenderer()) onImageClickedRef.current?.(e) })
    const unsubImageContextMenu = newRenderer.on('imageContextMenu', (e) => { if (isCurrentRenderer()) onImageContextMenuRef.current?.(e) })
    const unsubMediaError = newRenderer.on('mediaError', (e) => { if (isCurrentRenderer()) onMediaErrorRef.current?.(e) })
    const unsubMediaPlay = newRenderer.on('mediaPlay', (e) => { if (isCurrentRenderer()) onMediaPlayRef.current?.(e) })
    const unsubInstantAnnotation = newRenderer.on('instantAnnotation', (e) => { if (isCurrentRenderer()) onInstantAnnotationRef.current?.(e) })
    const unsubRendered = newRenderer.on('rendered', () => {
      if (!isMountedRenderer()) return
      if (previousMount && activeMountRef.current?.renderer !== newRenderer) {
        host.style.visibility = 'visible'
        previousMount.host.style.visibility = 'hidden'
        activeMountRef.current = mountRecord
        setRenderer(newRenderer)
        previousMount.dispose()
        if (stagedToc) onTocReadyRef.current?.(stagedToc)
        if (stagedRelocated) onRelocatedRef.current?.(stagedRelocated)
      }
      onViewRebuildingRef.current?.(false)
      onRenderedRef.current?.(url)
    })
    const unsubFontFallback = newRenderer.on('fontFallback', () => { if (isCurrentRenderer()) onFontFallbackRef.current?.() })
    const unsubViewRebuilding = newRenderer.on('viewRebuilding', (e) => { if (isCurrentRenderer()) onViewRebuildingRef.current?.(e.pending) })
    const unsubToc = newRenderer.on('tocReady', (items) => {
      if (!isMountedRenderer()) return
      if (previousMount && activeMountRef.current?.renderer !== newRenderer) stagedToc = items
      else onTocReadyRef.current?.(items)
    })
    const unsubJumpConfirmed = newRenderer.on('jumpConfirmed', (e) => { if (isCurrentRenderer()) onJumpConfirmedRef.current?.(e) })
    const unsubNavigatePending = newRenderer.on('navigatePending', (e) => { if (isCurrentRenderer()) onNavigatePendingRef.current?.(e) })
    const unsubRevisionNavigation = newRenderer.on('revisionNavigation', (e) => {
      if (!cancelled && (isCurrentRenderer() || activeMountRef.current?.renderer === newRenderer)) {
        onRevisionNavigationRef.current?.(e)
      }
    })
    const unsubRevisionChanged = newRenderer.on('revisionChanged', (e) => { if (isCurrentRenderer()) onRevisionChangedRef.current?.(e) })
    const unsubNavigateError = newRenderer.on('navigateError', (e) => { if (isCurrentRenderer()) onNavigateErrorRef.current?.(e) })
    const unsubChromeToggle = newRenderer.on('chromeToggle', () => { if (isCurrentRenderer()) onChromeToggleRef.current?.() })
    const unsubUserJump = newRenderer.on('userJump', () => { if (isCurrentRenderer()) onUserJumpRef.current?.() })
    const unsubReplacementInvalid = newRenderer.on('replacementInvalid', (e) => { if (isCurrentRenderer()) onReplacementInvalidRef.current?.(e) })
    const unsubAnnotationOrphaned = newRenderer.on('annotationOrphaned', (e) => { if (isCurrentRenderer()) onAnnotationOrphanedRef.current?.(e) })
    const unsubFootnoteOpen = newRenderer.on('footnoteOpen', (e) => { if (isCurrentRenderer()) onFootnoteOpenRef.current?.(e) })
    const unsubFootnoteClose = newRenderer.on('footnoteClose', () => { if (isCurrentRenderer()) onFootnoteCloseRef.current?.() })
    teardown = () => {
      unsubRelocated()
      unsubSelected()
      unsubTextSelectionStart()
      unsubAnnotationClicked()
      unsubImageClicked()
      unsubImageContextMenu()
      unsubMediaError()
      unsubMediaPlay()
      unsubInstantAnnotation()
      unsubRendered()
      unsubFontFallback()
      unsubViewRebuilding()
      unsubToc()
      unsubJumpConfirmed()
      unsubNavigatePending()
      unsubRevisionNavigation()
      unsubRevisionChanged()
      unsubNavigateError()
      unsubChromeToggle()
      unsubUserJump()
      unsubReplacementInvalid()
      unsubAnnotationOrphaned()
      unsubFootnoteOpen()
      unsubFootnoteClose()
    }
    if (!previousMount) activeMountRef.current = mountRecord

    return () => {
      if (activeMountRef.current?.renderer === newRenderer
        && desiredBookIdRef.current === bookId
        && (desiredUrlRef.current !== url || desiredMountGenerationRef.current !== mountGeneration)) return
      cancelled = true
      if (previousMount && activeMountRef.current?.renderer === previousMount.renderer
        && (desiredBookIdRef.current !== bookId
          || (desiredUrlRef.current === url && desiredMountGenerationRef.current === mountGeneration))) {
        previousMount.dispose()
      }
      if (rendererRef.current === newRenderer) onViewRebuildingRef.current?.(true)
      const position = newRenderer.getCurrentPosition?.()
      if (rendererRef.current === newRenderer && position
        && (position.cfi !== null || position.fraction !== null)) {
        remountPositionRef.current = { key: rendererKey, ...position }
      }
      mountRecord.dispose()
      setRenderer((current) => (current === newRenderer ? null : current))
    }
  }, [url, bookId, createRenderer, initialCfi, initialFraction, canMount, mountGeneration])

  // Navigate to the saved position once both renderer and progress are ready.
  // Skipping when initialCfi is undefined avoids a spurious goTo({ index: 0 })
  // that would be immediately overwritten by the real CFI from progress.
  const handledInitialCfiRef = useRef<string | null>(null)
  useEffect(() => {
    if (!renderer) return
    if (initialCfi === undefined) return
    if (initialCfi === handledInitialCfiRef.current) return
    handledInitialCfiRef.current = initialCfi
    void renderer.display(initialCfi, { internal: true })
  }, [renderer, initialCfi])

  // The renderer is part of the dependency list on purpose: the mount itself
  // applies the settings before any section exists, so the stylesheet only
  // reaches the loaded sections when these effects replay once the renderer
  // is live. Without that, a freshly loaded section could keep the book's own
  // CSS until the next settings change.
  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyReadingTheme({ bg: theme.pageBg, text: theme.text, primary: theme.primary })
  }, [theme, renderer])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyFont({ fontFamily, fontStack, fontCss, size: fontSize, lineHeight, fontWeight, overrideBookFont })
  }, [fontFamily, cjkFontFamily, fontStack, fontCss, fontSize, lineHeight, fontWeight, overrideBookFont, renderer])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyParagraphStyle({ paragraphSpacing, chapterTitleAlign, chapterTitleSize, chapterTitleTopSpacing, chapterTitleBottomSpacing, letterSpacing, indent, verticalPadding, horizontalPadding, textAlignJustify, overrideBookLayout })
  }, [paragraphSpacing, chapterTitleAlign, chapterTitleSize, chapterTitleTopSpacing, chapterTitleBottomSpacing, letterSpacing, indent, verticalPadding, horizontalPadding, textAlignJustify, overrideBookLayout, renderer])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyPageWidth(pageWidth)
  }, [pageWidth])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyChineseConversion(chineseConversion)
  }, [chineseConversion])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyContinuousScroll(continuousScroll)
  }, [continuousScroll])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyReadingMode(readingMode)
  }, [readingMode])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyPageColumns(pageColumns)
  }, [pageColumns])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyColumnGap(columnGap)
  }, [columnGap])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyPageAnimation(pageAnimation)
  }, [pageAnimation])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyShowHeader(showHeader)
  }, [showHeader])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyShowFooter(showFooter)
  }, [showFooter])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyClickSettings(clickAreaMode)
  }, [clickAreaMode])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyMarginals({
      header: [headerLeft, headerCenter, headerRight],
      footer: [footerLeft, footerCenter, footerRight],
      fontSize: marginalFontSize,
    })
  }, [headerLeft, headerCenter, headerRight, footerLeft, footerCenter, footerRight, marginalFontSize])

  // Re-runs when the renderer mounts: chapter counts often arrive while the
  // async mount is still in flight (rendererRef.current null then), and the
  // mount block above does not apply them — without the renderer dep they
  // would be dropped and the chapterWordCount marginal stays empty.
  useEffect(() => {
    const current = rendererRef.current
    if (!current || !chapterWordCounts) return
    current.setChapterWordCounts(chapterWordCounts)
  }, [chapterWordCounts, renderer])

  return { containerRef, renderer, fontStack, fontCss, preparationFailed: !fontsData && fontsQuery.isError, retryPreparation: fontsQuery.refetch }
}
