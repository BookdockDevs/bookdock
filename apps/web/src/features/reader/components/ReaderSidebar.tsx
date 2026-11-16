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
  tocPositionReady?: boolean
  onStatsTabOpen: () => void
  /** Whether the mobile reading controls were summoned by the reader chrome toggle. */
  chromePinned: boolean
  footerVisible?: boolean
  mobileDockVisible?: boolean
  onFooterSummon?: (summon: boolean) => void
  guestReadOnly: boolean
}

export const ReaderSidebar = memo(function ReaderSidebar({ bookId, tocPositionReady, onStatsTabOpen, chromePinned, footerVisible, mobileDockVisible, onFooterSummon, guestReadOnly }: ReaderSidebarProps) {
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
  const statsDisabled = guestReadOnly

  const SIDEBAR_MIN = 200
  const SIDEBAR_MAX = 640
  const SIDEBAR_MIN_HEIGHT = 320
  const DEFAULT_SIDEBAR_WIDTH = 288
  const TOOL_DOCK_WIDTH = 56

  const [locked, setLocked] = useState(toolbarLocked)
  const [hovered, setHovered] = useState(false)
  const [floatingActive, setFloatingActive] = useState(false)

  // Touch uses a bottom control sheet; desktop dock keeps its hover/lock behavior.
  const mobileControlsVisible = isTouch && (chromePinned || sidebarOpen)
  const panelRef = useRef<NavigationPanelRef>(null)

  const [panelWidth, setPanelWidth] = useState(sidebarWidth)
  const [floatingHeight, setFloatingHeight] = useState<number | null>(() => {
    try {
      const val = localStorage.getItem('bd-floating-sidebar-height')
      if (!val) return null
      const n = Number(val)
      return Number.isFinite(n) && n >= 320 ? n : null
    } catch {
      return null
    }
  })
  const floatingHeightRef = useRef(floatingHeight)

  type ResizeDirection = 'width' | 'height' | 'corner' | null
  const [resizingDir, setResizingDir] = useState<ResizeDirection>(null)
  const resizingDirRef = useRef<ResizeDirection>(null)
  const panelRefWidth = useRef(panelWidth)

  const dockRef = useRef<HTMLDivElement>(null)
  const sidebarContainerRef = useRef<HTMLDivElement>(null)
  const pointerPosRef = useRef<{ clientX: number; clientY: number } | null>(null)

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
    if (resizingDir) return
    setSidebarWidth(panelWidth)
  }, [panelWidth, resizingDir, setSidebarWidth])

  // Settle the unreported reading segment so the stats tab shows fresh numbers
  const statsTabActive = sidebarOpen && activeNavTab === 'stats'
  useEffect(() => {
    if (statsTabActive) onStatsTabOpen()
  }, [statsTabActive, onStatsTabOpen])

  const dragStartRef = useRef({ clientX: 0, clientY: 0, width: 0, height: 0 })

  const handleResizeStart = useCallback((direction: 'width' | 'height' | 'corner') => (e: React.PointerEvent) => {
    if (e.button !== 0 || resizingDirRef.current) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    panelRefWidth.current = panelWidth
    resizingDirRef.current = direction
    setResizingDir(direction)
    const currentHeight = sidebarContainerRef.current?.getBoundingClientRect().height ?? (window.innerHeight - 128)
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      width: panelWidth,
      height: currentHeight,
    }
    document.body.classList.add('reader-resizing')
    if (direction === 'height') {
      document.body.classList.add('reader-resizing-row')
    } else if (direction === 'corner') {
      document.body.classList.add('reader-resizing-corner')
    } else {
      document.body.classList.add('reader-resizing-col')
    }
  }, [panelWidth])

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    const dir = resizingDirRef.current
    if (!dir) return
    if (dir === 'width' || dir === 'corner') {
      const deltaX = e.clientX - dragStartRef.current.clientX
      const nextW = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragStartRef.current.width + deltaX))
      setPanelWidth(nextW)
      panelRefWidth.current = nextW
    }
    if (dir === 'height' || dir === 'corner') {
      const deltaY = e.clientY - dragStartRef.current.clientY
      const maxHeight = window.innerHeight - 80
      const nextH = Math.max(SIDEBAR_MIN_HEIGHT, Math.min(maxHeight, dragStartRef.current.height + deltaY))
      setFloatingHeight(nextH)
      floatingHeightRef.current = nextH
    }
  }, [])

  const handleResizeEnd = useCallback(() => {
    const dir = resizingDirRef.current
    if (!dir) return
    resizingDirRef.current = null
    setResizingDir(null)
    document.body.classList.remove('reader-resizing', 'reader-resizing-col', 'reader-resizing-row', 'reader-resizing-corner')
    if (dir === 'width' || dir === 'corner') {
      setSidebarWidth(panelRefWidth.current)
    }
    if (dir === 'height' || dir === 'corner') {
      try {
        if (floatingHeightRef.current == null) {
          localStorage.removeItem('bd-floating-sidebar-height')
        } else {
          localStorage.setItem('bd-floating-sidebar-height', String(floatingHeightRef.current))
        }
      } catch {}
    }
  }, [setSidebarWidth])

  useEffect(() => () => {
    document.body.classList.remove('reader-resizing', 'reader-resizing-col', 'reader-resizing-row', 'reader-resizing-corner')
  }, [])

  const handleResetWidth = useCallback(() => {
    setPanelWidth(DEFAULT_SIDEBAR_WIDTH)
    panelRefWidth.current = DEFAULT_SIDEBAR_WIDTH
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
  }, [setSidebarWidth])

  const handleResetHeight = useCallback(() => {
    setFloatingHeight(null)
    floatingHeightRef.current = null
    try {
      localStorage.removeItem('bd-floating-sidebar-height')
    } catch {}
  }, [])

  const handleResetBoth = useCallback(() => {
    handleResetWidth()
    handleResetHeight()
  }, [handleResetWidth, handleResetHeight])

  const isPointerInCorridor = useCallback(() => {
    if (!pointerPosRef.current) return false
    const { clientX, clientY } = pointerPosRef.current
    return clientX <= 70 && clientY >= 48 && clientY <= 380
  }, [])

  const handleNavTab = useCallback((tab: NavTab) => {
    if (sidebarOpen && activeNavTab === tab) {
      panelRef.current?.saveScroll()
      if (isPointerInCorridor()) {
        setHovered(true)
        setFloatingActive(true)
      }
      setSidebarOpen(false)
    } else {
      if (sidebarOpen) panelRef.current?.saveScroll()
      setActiveNavTab(tab)
      setSidebarOpen(true)
      setNavTabRemembered(tab)
    }
  }, [sidebarOpen, activeNavTab, isPointerInCorridor, setActiveNavTab, setSidebarOpen, setNavTabRemembered])

  const handleClosePanel = useCallback(() => {
    panelRef.current?.saveScroll()
    setSidebarOpen(false)
  }, [setSidebarOpen])

  // Floating dock corridor: starts below the 48px header and ends around y=380px,
  // matching the spatial envelope of the floating capsule.
  const isWithinFloatingCorridor = useCallback((clientY?: number | null) => {
    if (clientY == null || clientY === 0) return true
    return clientY >= 48 && clientY <= 380
  }, [])

  const handleHoverPointerEnter = useCallback((e: React.PointerEvent) => {
    if (locked || sidebarOpen) return
    if (!isWithinFloatingCorridor(e.clientY)) return
    const isLeftEdge = e.clientX == null || e.clientX <= 70
    if (isLeftEdge) {
      setHovered(true)
      setFloatingActive(true)
    }
  }, [locked, sidebarOpen, isWithinFloatingCorridor])

  const handleHoverPointerMove = useCallback((e: React.PointerEvent) => {
    pointerPosRef.current = { clientX: e.clientX, clientY: e.clientY }
    if (locked || sidebarOpen) return
    const inCorridor = isWithinFloatingCorridor(e.clientY)
    const isLeftEdge = (e.clientX == null || e.clientX <= 70) && inCorridor
    const isOverDock = inCorridor && Boolean(dockRef.current?.contains(e.target as Node))
    if (!isLeftEdge && !isOverDock) {
      if (hovered) setHovered(false)
      return
    }
    if (!hovered) {
      setHovered(true)
      setFloatingActive(true)
    }
  }, [locked, sidebarOpen, hovered, isWithinFloatingCorridor])

  const handleHoverPointerLeave = useCallback(() => {
    pointerPosRef.current = null
    setHovered(false)
  }, [])

  useEffect(() => {
    if (isTouch) return
    const updateFloatingHover = (clientX: number, clientY: number, buttons: number, hasSelection: boolean, target?: EventTarget | null) => {
      pointerPosRef.current = { clientX, clientY }
      if (locked || sidebarOpen) return
      const inZone = clientX <= 70 && clientY >= 48 && clientY <= 380
      const overDock = clientY >= 48 && clientY <= 380 && target instanceof Node && Boolean(dockRef.current?.contains(target))
      if (buttons || hasSelection || window.getSelection()?.type === 'Range') return
      if (inZone || overDock) {
        setHovered(true)
        setFloatingActive(true)
      } else if (hovered) {
        setHovered(false)
      }
    }
    const onPointerMove = (event: PointerEvent) => updateFloatingHover(event.clientX, event.clientY, event.buttons, false, event.target)
    const onFramePointerMove = (event: Event) => {
      const detail = (event as CustomEvent<{ clientX: number; clientY: number; buttons: number; hasSelection: boolean }>).detail
      if (detail) updateFloatingHover(detail.clientX, detail.clientY, detail.buttons, detail.hasSelection)
    }
    const onWindowLeave = () => {
      pointerPosRef.current = null
      setHovered(false)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('reader-pointermove', onFramePointerMove)
    window.addEventListener('pointerleave', onWindowLeave)
    window.addEventListener('blur', onWindowLeave)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('reader-pointermove', onFramePointerMove)
      window.removeEventListener('pointerleave', onWindowLeave)
      window.removeEventListener('blur', onWindowLeave)
    }
  }, [isTouch, locked, sidebarOpen, hovered])

  // Once mouse leaves the floating dock, allow fade out before dropping floating state
  useEffect(() => {
    if (!hovered && floatingActive && !sidebarOpen) {
      const timer = setTimeout(() => {
        setFloatingActive(false)
      }, 220)
      return () => clearTimeout(timer)
    }
  }, [hovered, floatingActive, sidebarOpen])

  function toggleTheme() {
    cycleReadingThemeMode()
  }

  const themeModeTitle = _('reader.themeModeTitle', { mode: _(`theme.${readingThemeMode}`) })

  const themeToggleFooter = (
    <button
      type="button"
      onClick={toggleTheme}
      title={themeModeTitle}
      aria-label={themeModeTitle}
      className={cn(
        'relative z-10 pointer-events-auto flex shrink-0 items-center justify-center rounded-xl text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current',
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
  )

  // -------------------------------------------------------------
  // BRANCH 1: Touch / Mobile View (Bottom Sheet)
  // -------------------------------------------------------------
  if (isTouch) {
    return (
      <>
        {sidebarOpen && (
          <div
            data-testid="sidebar-backdrop"
            className="fixed inset-0 z-40 bg-black/40"
            onClick={handleClosePanel}
          />
        )}
        <div
          id="reader-navigation"
          data-testid="reader-sidebar"
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-visible',
            mobileControlsVisible ? 'translate-y-0' : 'pointer-events-none translate-y-full',
            !resizingDir && 'transition-transform duration-200',
          )}
        >
          <div
            className={cn(
              'order-1 w-full overflow-hidden bg-[var(--bd-read-bg)] transition-[height]',
              sidebarOpen && (activeNavTab === 'ai' ? 'h-[80dvh] max-h-[720px]' : 'h-[65dvh] max-h-[520px]'),
              !sidebarOpen && 'h-0',
            )}
          >
            <div className="h-full w-full">
              <NavigationPanel
                key={bookId}
                ref={panelRef}
                bookId={bookId}
                tocPositionReady={tocPositionReady}
                open={sidebarOpen}
                locked={false}
                sidebarWidth={panelWidth}
                statsDisabled={statsDisabled}
                guestReadOnly={guestReadOnly}
                footerVisible={footerVisible}
                mobileDockVisible={mobileDockVisible}
                onFooterSummon={onFooterSummon}
                onClose={handleClosePanel}
              />
            </div>
          </div>
          <div
            ref={dockRef}
            data-testid="reader-tool-dock"
            data-toast-obstacle={mobileControlsVisible ? '' : undefined}
            className={cn(
              'order-2 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] w-full shrink-0 items-center border-t border-[var(--bd-read-accent)] px-1 pb-[env(safe-area-inset-bottom)] bg-[var(--bd-read-bg)]',
              mobileControlsVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            <ToolDock
              activeNavTab={activeNavTab}
              sidebarOpen={sidebarOpen}
              locked={false}
              floating={false}
              statsDisabled={statsDisabled}
              guestReadOnly={guestReadOnly}
              hideLock={true}
              mobile={true}
              onNavTab={handleNavTab}
              onToggleLock={() => {}}
              footer={themeToggleFooter}
            />
          </div>
        </div>
      </>
    )
  }

  // -------------------------------------------------------------
  // BRANCH 2: Pinned Desktop Sidebar (In-layout Side Column)
  // -------------------------------------------------------------
  if (locked) {
    return (
      <div
        ref={sidebarContainerRef}
        id="reader-navigation"
        data-testid="reader-sidebar"
        className="relative flex h-full shrink-0 z-40 overflow-visible"
        style={{ width: sidebarOpen ? TOOL_DOCK_WIDTH + panelWidth : TOOL_DOCK_WIDTH }}
      >
        <div
          ref={dockRef}
          data-testid="reader-tool-dock"
          className="order-none h-full w-[56px] flex shrink-0 flex-col items-center border-r border-[var(--bd-read-accent)] py-3 bg-[var(--bd-read-bg)] opacity-100"
        >
          <ToolDock
            activeNavTab={activeNavTab}
            sidebarOpen={sidebarOpen}
            locked={true}
            floating={false}
            statsDisabled={statsDisabled}
            guestReadOnly={guestReadOnly}
            hideLock={false}
            mobile={false}
            onNavTab={handleNavTab}
            onToggleLock={() => setLocked(false)}
            footer={themeToggleFooter}
          />
        </div>
        <div
          className={cn(
            'order-none h-full flex shrink-0 overflow-hidden bg-[var(--bd-read-bg)]',
            !resizingDir && 'transition-[width] duration-200 will-change-[width]',
          )}
          style={{ width: sidebarOpen ? panelWidth : 0 }}
        >
          <div className="h-full shrink-0" style={{ width: panelWidth }}>
            <NavigationPanel
              key={bookId}
              ref={panelRef}
              bookId={bookId}
              tocPositionReady={tocPositionReady}
              open={sidebarOpen}
              locked={true}
              sidebarWidth={panelWidth}
              statsDisabled={statsDisabled}
              guestReadOnly={guestReadOnly}
              footerVisible={footerVisible}
              mobileDockVisible={mobileDockVisible}
              onFooterSummon={onFooterSummon}
            />
          </div>
        </div>
        {sidebarOpen && (
          <div
            data-testid="reader-sidebar-resize-handle"
            className={cn(
              'group absolute left-full top-0 h-full w-2 touch-none border-l reader-resize-cursor transition-colors duration-150',
              resizingDir === 'width' ? 'border-[var(--bd-read-primary)]/50' : 'border-[var(--bd-read-accent)]/40',
            )}
            onPointerDown={handleResizeStart('width')}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            onLostPointerCapture={handleResizeEnd}
            onDoubleClick={handleResetWidth}
            title="双击恢复默认宽度"
          >
            <span
              className={cn(
                'pointer-events-none absolute left-1/2 top-1/2 h-7 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-150',
                resizingDir === 'width'
                  ? 'bg-[var(--bd-read-primary)]/60 opacity-100'
                  : 'bg-[var(--bd-read-sub)]/40 opacity-0 group-hover:opacity-100',
              )}
            />
          </div>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------
  // BRANCH 3: Unpinned Floating Mode
  // -------------------------------------------------------------
  if (sidebarOpen) {
    return (
      <div
        ref={sidebarContainerRef}
        id="reader-navigation"
        data-testid="reader-sidebar"
        className={cn(
          'absolute left-3 top-16 z-[45] flex rounded-2xl shadow-2xl ring-1 ring-[var(--bd-read-accent)]/80 backdrop-blur-md overflow-visible',
          floatingHeight == null ? 'bottom-16' : '',
        )}
        style={{
          width: 48 + panelWidth,
          backgroundColor: 'var(--bd-read-bg)',
          ...(floatingHeight != null ? { height: floatingHeight, maxHeight: 'calc(100vh - 5rem)' } : {}),
        }}
      >
        <div className="flex h-full w-full rounded-2xl overflow-hidden">
          {/* Dock Column */}
          <div
            ref={dockRef}
            data-testid="reader-tool-dock"
            className="order-none flex h-full w-12 shrink-0 flex-col items-center border-r border-[var(--bd-read-accent)]/60 p-1 opacity-100"
          >
            <ToolDock
              activeNavTab={activeNavTab}
              sidebarOpen={true}
              locked={false}
              floating={false}
              statsDisabled={statsDisabled}
              guestReadOnly={guestReadOnly}
              hideLock={false}
              mobile={false}
              onNavTab={handleNavTab}
              onToggleLock={() => setLocked(true)}
              footer={themeToggleFooter}
            />
          </div>

          {/* Panel Column */}
          <div className="relative flex h-full shrink-0 overflow-hidden" style={{ width: panelWidth }}>
            <div className="h-full shrink-0" style={{ width: panelWidth }}>
              <NavigationPanel
                key={bookId}
                ref={panelRef}
                bookId={bookId}
                tocPositionReady={tocPositionReady}
                open={true}
                locked={false}
                sidebarWidth={panelWidth}
                statsDisabled={statsDisabled}
                guestReadOnly={guestReadOnly}
                footerVisible={footerVisible}
                mobileDockVisible={mobileDockVisible}
                onFooterSummon={onFooterSummon}
              />
            </div>
          </div>
        </div>

        {/* Right Width Resize Handle */}
        <div
          data-testid="reader-sidebar-resize-handle"
          className="group absolute left-full top-2 bottom-4 w-2.5 touch-none reader-resize-cursor z-20"
          onPointerDown={handleResizeStart('width')}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onLostPointerCapture={handleResizeEnd}
          onDoubleClick={handleResetWidth}
          title="双击恢复默认宽度"
        >
          <span
            className={cn(
              'pointer-events-none absolute left-0 top-1/2 h-7 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-150',
              resizingDir === 'width' || resizingDir === 'corner'
                ? 'bg-[var(--bd-read-primary)]/60 opacity-100'
                : 'bg-[var(--bd-read-sub)]/40 opacity-0 group-hover:opacity-100',
            )}
          />
        </div>

        {/* Bottom Height Resize Handle */}
        <div
          data-testid="reader-sidebar-resize-handle-bottom"
          className="group absolute top-full left-2 right-4 h-2.5 touch-none cursor-row-resize z-20"
          onPointerDown={handleResizeStart('height')}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onLostPointerCapture={handleResizeEnd}
          onDoubleClick={handleResetHeight}
          title="双击恢复默认高度"
        >
          <span
            className={cn(
              'pointer-events-none absolute left-1/2 top-0 h-0.5 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-150',
              resizingDir === 'height' || resizingDir === 'corner'
                ? 'bg-[var(--bd-read-primary)]/60 opacity-100'
                : 'bg-[var(--bd-read-sub)]/40 opacity-0 group-hover:opacity-100',
            )}
          />
        </div>

        {/* Corner 2D Resize Handle */}
        <div
          data-testid="reader-sidebar-resize-handle-corner"
          className="group absolute top-full left-full -mt-1 -ml-1 h-3.5 w-3.5 touch-none cursor-nwse-resize z-30 flex items-center justify-center"
          onPointerDown={handleResizeStart('corner')}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onLostPointerCapture={handleResizeEnd}
          onDoubleClick={handleResetBoth}
          title="双击恢复默认尺寸"
        >
          <span
            className={cn(
              'pointer-events-none absolute left-1 top-1 h-2 w-2 rounded-br-[3px] border-r-2 border-b-2 transition-opacity duration-150',
              resizingDir === 'corner'
                ? 'border-[var(--bd-read-primary)]/70 opacity-100'
                : 'border-[var(--bd-read-sub)]/40 opacity-0 group-hover:opacity-100',
            )}
          />
        </div>
      </div>
    )
  }

  // Standalone Capsule Dock when closed
  const isCapsuleVisible = hovered && floatingActive
  return (
    <div
      id="reader-navigation"
      data-testid="reader-sidebar"
      className="contents absolute top-16 pointer-events-none"
    >
      <div
        ref={dockRef}
        data-testid="reader-tool-dock"
        className={cn(
          'absolute left-3 top-16 z-[45] h-auto w-12 flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--bd-read-accent)]/80 p-1 shadow-2xl backdrop-blur-md before:pointer-events-auto before:absolute before:-left-3 before:top-0 before:h-full before:w-3 before:content-[\'\'] transition-opacity duration-150',
          floatingActive ? '-mr-2' : '',
          isCapsuleVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ backgroundColor: 'color-mix(in srgb, var(--bd-read-bg) 92%, transparent)' }}
        onPointerEnter={handleHoverPointerEnter}
        onPointerMove={handleHoverPointerMove}
        onPointerLeave={handleHoverPointerLeave}
      >
        <ToolDock
          activeNavTab={activeNavTab}
          sidebarOpen={false}
          locked={false}
          floating={true}
          statsDisabled={statsDisabled}
          guestReadOnly={guestReadOnly}
          hideLock={false}
          mobile={false}
          onNavTab={handleNavTab}
          onToggleLock={() => setLocked(true)}
          footer={themeToggleFooter}
        />
      </div>
    </div>
  )
})
