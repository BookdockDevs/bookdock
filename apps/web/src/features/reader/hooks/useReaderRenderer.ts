import { useEffect, useMemo, useRef, useCallback, useState } from 'react'
import type { BookFormat } from '@bookdock/shared'

import { selectEffectiveReadingThemeId, useUiStore } from '@/stores/ui.store'
import { useFonts } from '@/api/hooks/useFonts'
import { resolveReadingTheme } from '@/lib/reading-theme'
import { FoliateReader } from '../renderers/FoliateReader'
import { fontCssFor, resolveFont } from '../fonts'
import type { BookReader, ClickAreaMode, MarginalField, RendererEvents } from '../types'
import type { EffectiveViewSettings } from '../lib/view-settings'

interface UseReaderRendererOptions {
  url: string
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
  onRendered?: () => void
  onError?: (err: Error) => void
  onTocReady?: (items: { label: string; href: string; level?: number }[]) => void
  onJumpConfirmed?: (e: { cfi: string }) => void
  onNavigatePending?: (e: Parameters<RendererEvents['navigatePending']>[0]) => void
  onNavigateError?: (e: Parameters<RendererEvents['navigateError']>[0]) => void
  onChromeToggle?: () => void
  onUserJump?: () => void
  onReplacementInvalid?: (e: Parameters<RendererEvents['replacementInvalid']>[0]) => void
  onAnnotationOrphaned?: (e: Parameters<RendererEvents['annotationOrphaned']>[0]) => void
  onFootnoteOpen?: (e: Parameters<RendererEvents['footnoteOpen']>[0]) => void
  onFootnoteClose?: () => void
}

export function useReaderRenderer({
  url,
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
  onError,
  onTocReady,
  onJumpConfirmed,
  onNavigatePending,
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
  const [renderer, setRenderer] = useState<BookReader | null>(null)

  const readingThemeId = useUiStore(selectEffectiveReadingThemeId)
  const customThemes = useUiStore((s) => s.customThemes)
  const fontFamily = useUiStore((s) => s.fontFamily)
  const fontPreferences = useUiStore((s) => s.fontPreferences)
  const fontOrder = useUiStore((s) => s.fontOrder)
  const storeFontSize = useUiStore((s) => s.fontSize)
  const fontWeight = useUiStore((s) => s.fontWeight)
  const storeLineHeight = useUiStore((s) => s.lineHeight)
  const paragraphSpacing = useUiStore((s) => s.paragraphSpacing)
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
  const { data: fontsData } = useFonts()
  const resolvedFont = resolveFont(fontFamily, fontsData?.data ?? [], fontPreferences, fontOrder)
  const fontStack = resolvedFont.stack
  const fontCss = fontCssFor(resolvedFont)

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
  const onErrorRef = useRef(onError)
  const onTocReadyRef = useRef(onTocReady)
  const onJumpConfirmedRef = useRef(onJumpConfirmed)
  const onNavigatePendingRef = useRef(onNavigatePending)
  const onNavigateErrorRef = useRef(onNavigateError)
  const onChromeToggleRef = useRef(onChromeToggle)
  const onUserJumpRef = useRef(onUserJump)
  const onReplacementInvalidRef = useRef(onReplacementInvalid)
  const onAnnotationOrphanedRef = useRef(onAnnotationOrphaned)
  const onFootnoteOpenRef = useRef(onFootnoteOpen)
  const onFootnoteCloseRef = useRef(onFootnoteClose)
  const theme = useMemo(() => resolveReadingTheme(readingThemeId, customThemes), [readingThemeId, customThemes])
  const themeRef = useRef(theme)
  const fontRef = useRef({ fontFamily, fontStack, fontCss, size: fontSize, lineHeight, fontWeight, overrideBookFont })
  const paragraphRef = useRef({ paragraphSpacing, letterSpacing, indent, verticalPadding, horizontalPadding, textAlignJustify, overrideBookLayout })
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
  onErrorRef.current = onError
  onTocReadyRef.current = onTocReady
  onJumpConfirmedRef.current = onJumpConfirmed
  onNavigatePendingRef.current = onNavigatePending
  onNavigateErrorRef.current = onNavigateError
  onChromeToggleRef.current = onChromeToggle
  onUserJumpRef.current = onUserJump
  onReplacementInvalidRef.current = onReplacementInvalid
  onAnnotationOrphanedRef.current = onAnnotationOrphaned
  onFootnoteOpenRef.current = onFootnoteOpen
  onFootnoteCloseRef.current = onFootnoteClose
  themeRef.current = theme
  fontRef.current = { fontFamily, fontStack, fontCss, size: fontSize, lineHeight, fontWeight, overrideBookFont }
  paragraphRef.current = { paragraphSpacing, letterSpacing, indent, verticalPadding, horizontalPadding, textAlignJustify, overrideBookLayout }
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

  const createRenderer = useCallback(() => new FoliateReader(url, bookId, bookSize, format), [bookId, bookSize, format, url])

  useEffect(() => {
    if (!containerRef.current || !url) return
    // Wait until the start position is known ('' means "no saved progress")
    // so mount navigates exactly once instead of goTo(0) then display(cfi).
    // Safe in deps: queries have staleTime Infinity, so initialCfi only
    // transitions undefined -> value once per book.
    if (initialCfi === undefined) return

    const newRenderer = createRenderer()
    rendererRef.current = newRenderer
    const theme = themeRef.current

    let cancelled = false
    const isCurrentRenderer = () => !cancelled && rendererRef.current === newRenderer
    const initialTarget = initialCfi
    // Fires once the view is live but BEFORE the initial chapter load resolves:
    // exposing the renderer here lets TOC jumps navigate immediately (a user
    // jump supersedes the in-flight open). lastDisplayedCfiRef is recorded in
    // the same call so the saved-position effect below never re-navigates over
    // a jump the user already made.
    const markReady = () => {
      if (!isCurrentRenderer()) return undefined
      lastDisplayedCfiRef.current = initialTarget
      setRenderer(newRenderer)
      return onReadyRef.current?.()
    }
    newRenderer.mount(containerRef.current, initialTarget, initialFraction, markReady).then(async () => {
      // StrictMode double-invokes this effect: the loser must not become the
      // current renderer — its view already bailed out of mount
      if (!isCurrentRenderer()) return
      // mount already navigated (initialTarget may be '' for "book start")
      lastDisplayedCfiRef.current = initialTarget
      setRenderer(newRenderer)
      newRenderer.applyReadingMode(readingModeRef.current)
      newRenderer.applyPageColumns(pageColumnsRef.current)
      newRenderer.applyColumnGap(columnGapRef.current)
      newRenderer.applyPageAnimation(pageAnimationRef.current)
      newRenderer.applyShowHeader(showHeaderRef.current)
      newRenderer.applyShowFooter(showFooterRef.current)
      newRenderer.applyReadingTheme({ bg: theme.pageBg, text: theme.text })
      newRenderer.applyFont(fontRef.current)
      newRenderer.applyParagraphStyle(paragraphRef.current)
      newRenderer.applyPageWidth(pageWidthRef.current)
      newRenderer.applyChineseConversion(chineseConversionRef.current)
      newRenderer.applyContinuousScroll(continuousScrollRef.current)
      newRenderer.applyClickSettings(clickAreaModeRef.current)
      newRenderer.applyMarginals(marginalConfigRef.current)
    }).catch((err) => {
      console.error('[FoliateReader] mount failed:', err)
      if (isCurrentRenderer()) onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)))
    })

    const unsubRelocated = newRenderer.on('relocated', (e) => { if (isCurrentRenderer()) onRelocatedRef.current?.(e) })
    const unsubSelected = newRenderer.on('selected', (e) => { if (isCurrentRenderer()) onSelectedRef.current?.(e) })
    const unsubTextSelectionStart = newRenderer.on('textSelectionStart', () => { if (isCurrentRenderer()) onTextSelectionStartRef.current?.() })
    const unsubAnnotationClicked = newRenderer.on('annotationClicked', (e) => { if (isCurrentRenderer()) onAnnotationClickedRef.current?.(e) })
    const unsubImageClicked = newRenderer.on('imageClicked', (e) => { if (isCurrentRenderer()) onImageClickedRef.current?.(e) })
    const unsubImageContextMenu = newRenderer.on('imageContextMenu', (e) => { if (isCurrentRenderer()) onImageContextMenuRef.current?.(e) })
    const unsubMediaError = newRenderer.on('mediaError', (e) => { if (isCurrentRenderer()) onMediaErrorRef.current?.(e) })
    const unsubMediaPlay = newRenderer.on('mediaPlay', (e) => { if (isCurrentRenderer()) onMediaPlayRef.current?.(e) })
    const unsubInstantAnnotation = newRenderer.on('instantAnnotation', (e) => { if (isCurrentRenderer()) onInstantAnnotationRef.current?.(e) })
    const unsubRendered = newRenderer.on('rendered', () => { if (isCurrentRenderer()) onRenderedRef.current?.() })
    const unsubToc = newRenderer.on('tocReady', (items) => { if (isCurrentRenderer()) onTocReadyRef.current?.(items) })
    const unsubJumpConfirmed = newRenderer.on('jumpConfirmed', (e) => { if (isCurrentRenderer()) onJumpConfirmedRef.current?.(e) })
    const unsubNavigatePending = newRenderer.on('navigatePending', (e) => { if (isCurrentRenderer()) onNavigatePendingRef.current?.(e) })
    const unsubNavigateError = newRenderer.on('navigateError', (e) => { if (isCurrentRenderer()) onNavigateErrorRef.current?.(e) })
    const unsubChromeToggle = newRenderer.on('chromeToggle', () => { if (isCurrentRenderer()) onChromeToggleRef.current?.() })
    const unsubUserJump = newRenderer.on('userJump', () => { if (isCurrentRenderer()) onUserJumpRef.current?.() })
    const unsubReplacementInvalid = newRenderer.on('replacementInvalid', (e) => { if (isCurrentRenderer()) onReplacementInvalidRef.current?.(e) })
    const unsubAnnotationOrphaned = newRenderer.on('annotationOrphaned', (e) => { if (isCurrentRenderer()) onAnnotationOrphanedRef.current?.(e) })
    const unsubFootnoteOpen = newRenderer.on('footnoteOpen', (e) => { if (isCurrentRenderer()) onFootnoteOpenRef.current?.(e) })
    const unsubFootnoteClose = newRenderer.on('footnoteClose', () => { if (isCurrentRenderer()) onFootnoteCloseRef.current?.() })

    return () => {
      cancelled = true
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
      unsubToc()
      unsubJumpConfirmed()
      unsubNavigatePending()
      unsubNavigateError()
      unsubChromeToggle()
      unsubUserJump()
      unsubReplacementInvalid()
      unsubAnnotationOrphaned()
      unsubFootnoteOpen()
      unsubFootnoteClose()
      newRenderer.destroy()
      if (rendererRef.current === newRenderer) rendererRef.current = null
      setRenderer((current) => (current === newRenderer ? null : current))
    }
  }, [url, createRenderer, initialCfi, initialFraction])

  // Navigate to the saved position once both renderer and progress are ready.
  // Skipping when initialCfi is undefined avoids a spurious goTo({ index: 0 })
  // that would be immediately overwritten by the real CFI from progress.
  const lastDisplayedCfiRef = useRef<string | null>(null)
  useEffect(() => {
    if (!renderer) return
    if (initialCfi === undefined) return
    if (initialCfi === lastDisplayedCfiRef.current) return
    lastDisplayedCfiRef.current = initialCfi
    void renderer.display(initialCfi, { internal: true })
  }, [renderer, initialCfi])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyReadingTheme({ bg: theme.pageBg, text: theme.text })
  }, [theme])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyFont({ fontFamily, fontStack, fontCss, size: fontSize, lineHeight, fontWeight, overrideBookFont })
  }, [fontFamily, fontStack, fontCss, fontSize, lineHeight, fontWeight, overrideBookFont])

  useEffect(() => {
    const current = rendererRef.current
    if (!current) return
    current.applyParagraphStyle({ paragraphSpacing, letterSpacing, indent, verticalPadding, horizontalPadding, textAlignJustify, overrideBookLayout })
  }, [paragraphSpacing, letterSpacing, indent, verticalPadding, horizontalPadding, textAlignJustify, overrideBookLayout])

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

  return { containerRef, renderer, fontStack, fontCss }
}
