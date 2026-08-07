import { useEffect, useMemo, useRef, useCallback, useState } from 'react'
import { useUiStore } from '@/stores/ui.store'
import { resolveReadingTheme } from '@/lib/reading-theme'
import { FoliateReader } from '../renderers/FoliateReader'
import type { BookReader, ClickAreaMode, MarginalField, RendererEvents } from '../types'
import type { EffectiveViewSettings } from '../lib/view-settings'

interface UseReaderRendererOptions {
  url: string
  initialCfi?: string
  /** Per-book merged values for the first-batch settings (F1). When omitted,
   *  the global store values are used. */
  settings?: EffectiveViewSettings
  /** Per-chapter word counts, indexed by chapter (info-bar word count field) */
  chapterWordCounts?: (number | undefined)[]
  onRelocated?: (e: Parameters<RendererEvents['relocated']>[0]) => void
  onSelected?: (e: Parameters<RendererEvents['selected']>[0]) => void
  onAnnotationClicked?: (e: Parameters<RendererEvents['annotationClicked']>[0]) => void
  onInstantAnnotation?: (e: Parameters<RendererEvents['instantAnnotation']>[0]) => void
  onRendered?: () => void
  onError?: (err: Error) => void
  onTocReady?: (items: { label: string; href: string; level?: number }[]) => void
  onJumpConfirmed?: (e: { cfi: string }) => void
  onNavigatePending?: (e: { pending: boolean }) => void
  onChromeToggle?: () => void
  onUserJump?: () => void
}

export function useReaderRenderer({
  url,
  initialCfi,
  settings,
  chapterWordCounts,
  onRelocated,
  onSelected,
  onAnnotationClicked,
  onInstantAnnotation,
  onRendered,
  onError,
  onTocReady,
  onJumpConfirmed,
  onNavigatePending,
  onChromeToggle,
  onUserJump,
}: UseReaderRendererOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<BookReader | null>(null)
  const [renderer, setRenderer] = useState<BookReader | null>(null)

  const readingThemeId = useUiStore((s) => s.readingThemeId)
  const customThemes = useUiStore((s) => s.customThemes)
  const fontFamily = useUiStore((s) => s.fontFamily)
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

  const onRelocatedRef = useRef(onRelocated)
  const onSelectedRef = useRef(onSelected)
  const onAnnotationClickedRef = useRef(onAnnotationClicked)
  const onInstantAnnotationRef = useRef(onInstantAnnotation)
  const onRenderedRef = useRef(onRendered)
  const onErrorRef = useRef(onError)
  const onTocReadyRef = useRef(onTocReady)
  const onJumpConfirmedRef = useRef(onJumpConfirmed)
  const onNavigatePendingRef = useRef(onNavigatePending)
  const onChromeToggleRef = useRef(onChromeToggle)
  const onUserJumpRef = useRef(onUserJump)
  const theme = useMemo(() => resolveReadingTheme(readingThemeId, customThemes), [readingThemeId, customThemes])
  const themeRef = useRef(theme)
  const fontRef = useRef({ fontFamily, size: fontSize, lineHeight, fontWeight, overrideBookFont })
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
  onSelectedRef.current = onSelected
  onAnnotationClickedRef.current = onAnnotationClicked
  onInstantAnnotationRef.current = onInstantAnnotation
  onRenderedRef.current = onRendered
  onErrorRef.current = onError
  onTocReadyRef.current = onTocReady
  onJumpConfirmedRef.current = onJumpConfirmed
  onNavigatePendingRef.current = onNavigatePending
  onChromeToggleRef.current = onChromeToggle
  onUserJumpRef.current = onUserJump
  themeRef.current = theme
  fontRef.current = { fontFamily, size: fontSize, lineHeight, fontWeight, overrideBookFont }
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

  const createRenderer = useCallback(() => new FoliateReader(url), [url])

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
    const initialTarget = initialCfi
    newRenderer.mount(containerRef.current, initialTarget).then(async () => {
      // StrictMode double-invokes this effect: the loser must not become the
      // current renderer — its view already bailed out of mount
      if (cancelled) return
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
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)))
    })

    const unsubRelocated = newRenderer.on('relocated', (e) => onRelocatedRef.current?.(e))
    const unsubSelected = newRenderer.on('selected', (e) => onSelectedRef.current?.(e))
    const unsubAnnotationClicked = newRenderer.on('annotationClicked', (e) => onAnnotationClickedRef.current?.(e))
    const unsubInstantAnnotation = newRenderer.on('instantAnnotation', (e) => onInstantAnnotationRef.current?.(e))
    const unsubRendered = newRenderer.on('rendered', () => onRenderedRef.current?.())
    const unsubToc = newRenderer.on('tocReady', (items) => onTocReadyRef.current?.(items))
    const unsubJumpConfirmed = newRenderer.on('jumpConfirmed', (e) => onJumpConfirmedRef.current?.(e))
    const unsubNavigatePending = newRenderer.on('navigatePending', (e) => onNavigatePendingRef.current?.(e))
    const unsubChromeToggle = newRenderer.on('chromeToggle', () => onChromeToggleRef.current?.())
    const unsubUserJump = newRenderer.on('userJump', () => onUserJumpRef.current?.())

    return () => {
      cancelled = true
      unsubRelocated()
      unsubSelected()
      unsubAnnotationClicked()
      unsubInstantAnnotation()
      unsubRendered()
      unsubToc()
      unsubJumpConfirmed()
      unsubNavigatePending()
      unsubChromeToggle()
      unsubUserJump()
      newRenderer.destroy()
      rendererRef.current = null
      setRenderer((current) => (current === newRenderer ? null : current))
    }
  }, [url, createRenderer, initialCfi])

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
    current.applyFont({ fontFamily, size: fontSize, lineHeight, fontWeight, overrideBookFont })
  }, [fontFamily, fontSize, lineHeight, fontWeight, overrideBookFont])

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

  useEffect(() => {
    const current = rendererRef.current
    if (!current || !chapterWordCounts) return
    current.setChapterWordCounts(chapterWordCounts)
  }, [chapterWordCounts])

  return { containerRef, renderer }
}
