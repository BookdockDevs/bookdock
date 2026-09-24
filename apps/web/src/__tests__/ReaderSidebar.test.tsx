import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'

import { useReaderState } from '../features/reader/state/reader-state'
import { useUiStore } from '../stores/ui.store'
import { ReaderSidebar } from '../features/reader/components/ReaderSidebar'

const saveScrollMock = vi.hoisted(() => vi.fn())

vi.mock('../features/reader/components/NavigationPanel', () => ({
  NavigationPanel: forwardRef(function NavigationPanelStub(_props: object, ref: React.Ref<unknown>) {
    useImperativeHandle(ref, () => ({ saveScroll: saveScrollMock }))
    return <div data-testid="navigation-panel" />
  }),
}))

let coarsePointer = false

function outerEl(container: HTMLElement) {
  return container.querySelector('[data-testid="reader-sidebar"]') as HTMLElement
}

function dockEl(container: HTMLElement) {
  return container.querySelector('[data-testid="reader-tool-dock"]') as HTMLElement
}

function renderSidebar(chromePinned = false) {
  return render(<ReaderSidebar bookId="b1" onStatsTabOpen={vi.fn()} chromePinned={chromePinned} guestReadOnly={false} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  saveScrollMock.mockClear()
  window.localStorage.clear()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(pointer: coarse)' ? coarsePointer : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
  act(() => {
    useReaderState.setState({ sidebarOpen: false, activeNavTab: 'toc' })
    useUiStore.setState({
      toolbarLocked: false,
      readingThemeMode: 'system',
      systemTheme: 'light',
      readingThemeId: 'paper',
      lightReadingThemeId: 'paper',
    })
  })
})

describe('ReaderSidebar on touch devices', () => {
  beforeEach(() => {
    coarsePointer = true
  })

  it('keeps the dock hidden when chrome is not pinned', () => {
    const { container } = renderSidebar(false)
    expect(dockEl(container)).toHaveClass('opacity-0', 'pointer-events-none')
    expect(outerEl(container)).toHaveClass('translate-y-full')
  })

  it('reveals a bottom toolbar without reserving reader width when chrome is pinned', () => {
    const { container } = renderSidebar(true)
    expect(dockEl(container)).toHaveClass('opacity-100')
    expect(outerEl(container)).toHaveClass('fixed', 'inset-x-0', 'bottom-0')
    expect(outerEl(container).style.width).toBe('')
  })

  it('ignores the persisted toolbar lock', () => {
    act(() => useUiStore.setState({ toolbarLocked: true }))
    const { container } = renderSidebar(false)
    expect(dockEl(container)).toHaveClass('opacity-0', 'pointer-events-none')
  })

  it('hides the lock button', () => {
    renderSidebar(true)
    expect(screen.queryByTitle('固定工具栏')).toBeNull()
    expect(screen.getByTitle('目录')).toBeInTheDocument()
  })

  it('shows a backdrop with the panel and closes only the panel on backdrop tap', () => {
    act(() => useReaderState.setState({ sidebarOpen: true }))
    const { container } = renderSidebar(true)
    fireEvent.click(screen.getByTestId('sidebar-backdrop'))
    expect(useReaderState.getState().sidebarOpen).toBe(false)
    expect(dockEl(container)).toHaveClass('opacity-100')
  })

  it('uses a full-width bottom sheet and drops the resize handle', () => {
    act(() => useReaderState.setState({ sidebarOpen: true }))
    const { container } = renderSidebar(true)
    const panel = outerEl(container).children[0] as HTMLElement
    expect(panel).toHaveClass('h-[65dvh]', 'max-h-[520px]')
    expect(container.querySelector('.cursor-col-resize')).toBeNull()
  })

  it('gives the AI panel more vertical room without changing other tabs', () => {
    act(() => useReaderState.setState({ sidebarOpen: true, activeNavTab: 'ai' }))
    const { container } = renderSidebar(true)
    const panel = outerEl(container).children[0] as HTMLElement
    expect(panel).toHaveClass('h-[80dvh]', 'max-h-[720px]')
    expect(panel).not.toHaveClass('h-[65dvh]', 'max-h-[520px]')
  })
})

describe('ReaderSidebar on pointer devices', () => {
  beforeEach(() => {
    coarsePointer = false
  })

  it('keeps the hover summon: collapsed strip reveals the dock on hover', () => {
    const { container } = renderSidebar(false)
    expect(dockEl(container)).toHaveClass('opacity-0', 'pointer-events-none')
    expect(outerEl(container).style.width).toBe('8px')
    fireEvent.pointerEnter(outerEl(container))
    expect(dockEl(container)).toHaveClass('opacity-100')
    fireEvent.pointerLeave(outerEl(container))
    expect(dockEl(container)).toHaveClass('opacity-0', 'pointer-events-none')
  })

  it('honors the persisted toolbar lock', () => {
    act(() => useUiStore.setState({ toolbarLocked: true }))
    const { container } = renderSidebar(false)
    expect(dockEl(container)).toHaveClass('opacity-100')
    expect(outerEl(container)).toHaveClass('relative', 'shrink-0')
  })

  it('keeps unpinned sidebar in absolute overlay to never affect content layout', () => {
    const { container } = renderSidebar(false)
    expect(outerEl(container)).toHaveClass('absolute', 'left-0', 'top-0', 'bottom-0')
    expect(outerEl(container)).not.toHaveClass('relative', 'shrink-0')
  })

  it('shows the lock button and the resize handle, and no backdrop', () => {
    act(() => useReaderState.setState({ sidebarOpen: true }))
    renderSidebar(false)
    expect(screen.getByTitle('固定工具栏')).toBeInTheDocument()
    expect(screen.getByTestId('reader-sidebar-resize-handle')).toHaveClass('reader-resize-cursor')
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull()
  })

  it('does not save a hidden panel position when opening the sidebar', () => {
    renderSidebar(false)
    fireEvent.click(screen.getByTitle('目录'))
    expect(saveScrollMock).not.toHaveBeenCalled()
  })

  it('cycles the reading theme through system, light, and dark modes', () => {
    renderSidebar(false)

    const themeButton = screen.getByTitle('reader.themeModeTitle')
    fireEvent.click(themeButton)
    expect(useUiStore.getState().readingThemeMode).toBe('light')
    fireEvent.click(screen.getByTitle('reader.themeModeTitle'))
    expect(useUiStore.getState().readingThemeMode).toBe('dark')
    fireEvent.click(screen.getByTitle('reader.themeModeTitle'))
    expect(useUiStore.getState().readingThemeMode).toBe('system')
  })

  it('keeps the resize handle outside the navigation panel scrollbar', () => {
    act(() => useReaderState.setState({ sidebarOpen: true }))
    const { container } = renderSidebar(false)
    const handle = screen.getByTestId('reader-sidebar-resize-handle')
    expect(handle.parentElement).toBe(outerEl(container))
    expect(handle.closest('[data-testid="navigation-panel"]')).toBeNull()
  })

  it('summons dock when hovering along the floating dock corridor and ignores header zone', () => {
    const { container } = renderSidebar(false)
    // Header zone (y < 48): does not summon floating dock to protect header back button
    fireEvent.pointerEnter(outerEl(container), { clientY: 24 })
    expect(dockEl(container)).toHaveClass('opacity-0', 'pointer-events-none')

    // Floating dock corridor where TOC button lives (y = 80): summons dock
    fireEvent.pointerEnter(outerEl(container), { clientY: 80 })
    expect(dockEl(container)).toHaveClass('opacity-100')
    expect(outerEl(container).style.width).toBe('8px')

    // Moving down into lower reading zone (y > 380): collapses dock
    fireEvent.pointerMove(outerEl(container), { clientY: 500 })
    expect(dockEl(container)).toHaveClass('opacity-0', 'pointer-events-none')

    // Re-entering floating dock corridor: summons dock
    fireEvent.pointerMove(outerEl(container), { clientY: 80 })
    expect(dockEl(container)).toHaveClass('opacity-100')

    // Leaves dock: collapses
    fireEvent.pointerLeave(outerEl(container))
    expect(dockEl(container)).toHaveClass('opacity-0', 'pointer-events-none')
  })

  it('renders a floating island dock decoupled from top and bottom bars when unlocked', () => {
    const { container } = renderSidebar(false)
    fireEvent.pointerEnter(outerEl(container))
    const dock = dockEl(container)
    expect(dock).toHaveClass('absolute', 'left-3', 'top-16', 'rounded-2xl', 'backdrop-blur-md')
    expect(outerEl(container)).toHaveClass('-mr-2')
  })

  it('does not flash as floating dock when closing unpinned sidebar', () => {
    act(() => useReaderState.setState({ sidebarOpen: true }))
    const { container } = renderSidebar(false)
    const dock = dockEl(container)
    expect(dock).toHaveClass('order-none', 'h-full', 'w-[56px]')
    expect(dock).not.toHaveClass('absolute', 'rounded-2xl')

    act(() => useReaderState.setState({ sidebarOpen: false }))

    expect(dockEl(container)).toHaveClass('order-none', 'h-full', 'w-[56px]')
    expect(dockEl(container)).not.toHaveClass('absolute', 'left-3', 'top-16')
    expect(outerEl(container)).toHaveClass('overflow-hidden')
    expect(outerEl(container)).not.toHaveClass('-mr-2')
    expect(outerEl(container).style.width).toBe('8px')
  })
})

