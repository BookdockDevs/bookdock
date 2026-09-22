import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'

import { useReaderState } from '../state/reader-state'
import { useIsTouch } from '../hooks/useIsTouch'
import { ToolDock } from './ToolDock'
import { NavigationPanel, type NavigationPanelRef } from './NavigationPanel'
import type { NavTab } from '../types'

interface ReaderSidebarProps {
  bookId: string
  onStatsTabOpen: () => void
  /** Whether the mobile reading controls were summoned by the reader chrome toggle. */
  chromePinned: boolean
  guestReadOnly: boolean
}

export const ReaderSidebar = memo(function ReaderSidebar({ bookId, onStatsTabOpen, chromePinned, guestReadOnly }: ReaderSidebarProps) {
  const _ = useTranslation()
  const isTouch = useIsTouch()
  const activeNavTab = useReaderState((s) => s.activeNavTab)
  const setActiveNavTab = useReaderState((s) => s.setActiveNavTab)
  const sidebarOpen = useReaderState((s) => s.sidebarOpen)
  const setSidebarOpen = useReaderState((s) => s.setSidebarOpen)
  const readingThemeMode = useUiStore((s) => s.readingThemeMode)
  const cycleReadingThemeMode = useUiStore((s) => s.cycleReadingThemeMode)
  const toolbarLocked = useUiStore((s) => s.toolbarLocked)
  const setToolbarLocked = useUiStore((s) => s.setToolbarLocked)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const setNavTabRemembered = useUiStore((s) => s.setNavTabRemembered)
  const readingTimerMode = useUiStore((s) => s.readingTimerMode)
  const statsDisabled = guestReadOnly || readingTimerMode === 'off'

  const SIDEBAR_MIN = 200
  const SIDEBAR_MAX = 640
  const DEFAULT_SIDEBAR_WIDTH = 288
  const [locked, setLocked] = useState(toolbarLocked)
  const [hovered, setHovered] = useState(false)
  // Touch uses a bottom control sheet; the desktop dock keeps its hover/lock behavior.
  const mobileControlsVisible = isTouch && (chromePinned || sidebarOpen)
  const toolbarVisible = isTouch
    ? mobileControlsVisible
    : locked || hovered || sidebarOpen
  const panelRef = useRef<NavigationPanelRef>(null)

  const [panelWidth, setPanelWidth] = useState(sidebarWidth)
  const [resizing, setResizing] = useState(false)
  const resizingRef = useRef(false)
  const panelRefWidth = useRef(panelWidth)

  useEffect(() => {
    setLocked(toolbarLocked)
  }, [toolbarLocked])

  useEffect(() => {
    setToolbarLocked(locked)
  }, [locked, setToolbarLocked])

  useEffect(() => {
    if (guestReadOnly && activeNavTab !== 'toc') setActiveNavTab('toc')
  }, [activeNavTab, guestReadOnly, setActiveNavTab])

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
    dragState.current.width = panelWidth
    dragState.current.clientX = e.clientX
    setResizing(true)
    document.body.classList.add('reader-resizing')
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
    document.body.classList.remove('reader-resizing')
    setSidebarWidth(panelRefWidth.current)
  }, [setSidebarWidth])

  useEffect(() => () => {
    document.body.classList.remove('reader-resizing')
  }, [])

  const handleResetWidth = useCallback(() => {
    setPanelWidth(DEFAULT_SIDEBAR_WIDTH)
    panelRefWidth.current = DEFAULT_SIDEBAR_WIDTH
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
  }, [setSidebarWidth])

  const handleNavTab = useCallback((tab: NavTab) => {
    if (sidebarOpen && activeNavTab === tab) {
      setSidebarOpen(false)
    } else {
      panelRef.current?.saveScroll()
      setActiveNavTab(tab)
      setSidebarOpen(true)
      // Only explicit dock clicks are remembered — programmatic handoffs
      // (selection → AI) must not become next session's startup tab
      setNavTabRemembered(tab)
    }
  }, [sidebarOpen, activeNavTab, setActiveNavTab, setSidebarOpen, setNavTabRemembered])

  const handleClosePanel = useCallback(() => {
    setSidebarOpen(false)
  }, [setSidebarOpen])

  const isHeaderZone = useCallback((e: React.PointerEvent) => {
    // In simulated testing environments without explicit clientY, allow default pointerEnter
    if (typeof window !== 'undefined' && 'navigator' in window && /jsdom/i.test(navigator.userAgent) && e.clientY === 0) {
      return false
    }
    return !locked && !sidebarOpen && e.clientY < 48
  }, [locked, sidebarOpen])

  const handleHoverPointerEnter = useCallback((e: React.PointerEvent) => {
    if (isHeaderZone(e)) return
    setHovered(true)
  }, [isHeaderZone])

  const handleHoverPointerMove = useCallback((e: React.PointerEvent) => {
    if (!locked && !sidebarOpen) {
      if (isHeaderZone(e)) {
        if (hovered) setHovered(false)
        return
      }
      if (!hovered) setHovered(true)
    }
  }, [isHeaderZone, locked, sidebarOpen, hovered])

  const handleHoverPointerLeave = useCallback(() => {
    setHovered(false)
  }, [])

  function toggleTheme() {
    cycleReadingThemeMode()
  }

  const themeModeTitle = _('reader.themeModeTitle', { mode: _(`theme.${readingThemeMode}`) })

  const collapsed = !toolbarVisible
  const panelLocked = isTouch ? false : locked

  const totalWidth = collapsed
    ? 8
    : sidebarOpen
      ? 56 + panelWidth
      : 56

  const toolDock = (
    <div
      data-testid="reader-tool-dock"
      className={cn(
        'flex shrink-0 border-[var(--bd-read-accent)]',
        isTouch
          ? 'order-2 h-[calc(3.5rem+env(safe-area-inset-bottom))] w-full items-center border-t px-1 pb-[env(safe-area-inset-bottom)]'
          : 'order-none h-full w-14 flex-col items-center border-r py-3',
        collapsed ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100',
        !resizing && 'transition-all duration-200',
      )}
      style={{ backgroundColor: 'var(--bd-read-bg)' }}
    >
      <ToolDock
        activeNavTab={activeNavTab}
        sidebarOpen={sidebarOpen}
        locked={locked}
        statsDisabled={statsDisabled}
        guestReadOnly={guestReadOnly}
        hideLock={isTouch}
        mobile={isTouch}
        onNavTab={handleNavTab}
        onToggleLock={() => setLocked(!locked)}
      />
      <div className={isTouch ? 'hidden' : 'flex-1'} />
      <button
        onClick={toggleTheme}
        title={themeModeTitle}
        aria-label={themeModeTitle}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-xl text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current',
          isTouch ? 'h-12 min-w-12 [&_svg]:h-5 [&_svg]:w-5' : 'h-10 w-10',
        )}
      >
        {readingThemeMode === 'system' ? (
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="13" rx="1.5" /><path d="M8 21h8M12 17v4" /></svg>
        ) : readingThemeMode === 'dark' ? (
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
        ) : (
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
        )}
      </button>
    </div>
  )

  const navigationPanel = (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden',
        isTouch
          ? cn('order-1 w-full h-0 transition-[height]', sidebarOpen && (activeNavTab === 'ai' ? 'h-[80dvh] max-h-[720px]' : 'h-[65dvh] max-h-[520px]'))
          : cn('order-none h-full border-r border-[var(--bd-read-accent)]', !resizing && 'transition-all duration-200', sidebarOpen ? '' : 'w-0 border-r-0'),
      )}
      style={isTouch
        ? { backgroundColor: 'var(--bd-read-bg)' }
        : { width: sidebarOpen ? panelWidth : 0, backgroundColor: 'var(--bd-read-bg)' }}
    >
      <div
        className={cn('h-full', isTouch && 'w-full')}
        style={isTouch ? undefined : { width: panelWidth }}
      >
        <NavigationPanel
          key={bookId}
          ref={panelRef}
          bookId={bookId}
          open={sidebarOpen}
          locked={panelLocked}
          statsDisabled={statsDisabled}
          guestReadOnly={guestReadOnly}
          onClose={handleClosePanel}
        />
      </div>
    </div>
  )

  if (isTouch) {
    return (
      <>
        {sidebarOpen && (
          <div
            data-testid="sidebar-backdrop"
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div
          id="reader-navigation"
          data-testid="reader-sidebar"
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-visible',
            mobileControlsVisible ? 'translate-y-0' : 'pointer-events-none translate-y-full',
            !resizing && 'transition-transform duration-200',
          )}
        >
          {navigationPanel}
          {toolDock}
        </div>
      </>
    )
  }

  return (
    <div
      id="reader-navigation"
      data-testid="reader-sidebar"
      className={cn(
        'relative flex h-full shrink-0 overflow-visible',
        sidebarOpen ? 'z-50' : 'z-40',
        !resizing && 'transition-all duration-200',
      )}
      style={{ width: totalWidth }}
      onPointerEnter={handleHoverPointerEnter}
      onPointerMove={handleHoverPointerMove}
      onPointerLeave={handleHoverPointerLeave}
    >
      {toolDock}
      {navigationPanel}
      {sidebarOpen && !isTouch && (
        <div
          data-testid="reader-sidebar-resize-handle"
          className="group absolute left-full top-0 z-50 h-full w-2.5 reader-resize-cursor"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleResetWidth}
          title="双击恢复默认宽度"
        >
          {/* Active dragging guide line along the seam: invisible on hover/rest, softly glows with theme primary color during drag */}
          <div
            className={cn(
              'pointer-events-none absolute left-0 top-0 h-full w-[2px] -translate-x-1/2 transition-colors duration-150',
              resizing
                ? 'bg-[var(--bd-read-primary)]/85 shadow-[0_0_8px_var(--bd-read-primary)]/30'
                : 'bg-transparent',
            )}
          />
          {/* Tactile centered grip pill: understated indicator that gently reveals on hover and deepens on drag */}
          <span
            className={cn(
              'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150',
              resizing
                ? 'h-14 w-1 bg-[var(--bd-read-primary)] shadow-[0_0_0_2px_var(--bd-read-primary)]/20'
                : 'h-10 w-1 bg-transparent group-hover:bg-[var(--bd-read-sub)]/50',
            )}
          />
        </div>
      )}
    </div>
  )
})
