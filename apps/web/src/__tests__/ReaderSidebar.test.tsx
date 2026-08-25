import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'

import { useReaderState } from '../features/reader/state/reader-state'
import { useUiStore } from '../stores/ui.store'
import { ReaderSidebar } from '../features/reader/components/ReaderSidebar'

vi.mock('../features/reader/components/NavigationPanel', () => ({
  NavigationPanel: forwardRef(function NavigationPanelStub(_props: object, ref: React.Ref<unknown>) {
    useImperativeHandle(ref, () => ({ saveScroll: () => undefined }))
    return <div data-testid="navigation-panel" />
  }),
}))

let coarsePointer = false

function outerEl(container: HTMLElement) {
  return container.querySelector('.z-50') as HTMLElement
}

function dockEl(container: HTMLElement) {
  return container.querySelector('.w-14') as HTMLElement
}

function renderSidebar(chromePinned = false) {
  return render(<ReaderSidebar bookId="b1" onStatsTabOpen={vi.fn()} chromePinned={chromePinned} />)
}

beforeEach(() => {
  vi.clearAllMocks()
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
    useUiStore.setState({ toolbarLocked: false })
  })
})

describe('ReaderSidebar on touch devices', () => {
  beforeEach(() => {
    coarsePointer = true
  })

  it('keeps the dock hidden when chrome is not pinned', () => {
    const { container } = renderSidebar(false)
    expect(dockEl(container)).toHaveClass('opacity-0', 'pointer-events-none')
    expect(outerEl(container).style.width).toBe('0px')
  })

  it('reveals the dock as a zero-push overlay when chrome is pinned', () => {
    const { container } = renderSidebar(true)
    expect(dockEl(container)).toHaveClass('opacity-100')
    expect(outerEl(container)).toHaveClass('absolute')
    expect(outerEl(container).style.width).toBe('56px')
  })

  it('ignores the persisted toolbar lock', () => {
    act(() => useUiStore.setState({ toolbarLocked: true }))
    const { container } = renderSidebar(false)
    expect(dockEl(container)).toHaveClass('opacity-0', 'pointer-events-none')
  })

  it('hides the lock button', () => {
    renderSidebar(true)
    expect(screen.queryByTitle('锁定工具栏')).toBeNull()
    expect(screen.getByTitle('目录')).toBeInTheDocument()
  })

  it('shows a backdrop with the panel and closes only the panel on backdrop tap', () => {
    act(() => useReaderState.setState({ sidebarOpen: true }))
    const { container } = renderSidebar(true)
    fireEvent.click(screen.getByTestId('sidebar-backdrop'))
    expect(useReaderState.getState().sidebarOpen).toBe(false)
    // the dock stays summoned by chromePinned after the panel closes
    expect(dockEl(container)).toHaveClass('opacity-100')
  })

  it('fixes the panel width and drops the resize handle', () => {
    act(() => useReaderState.setState({ sidebarOpen: true }))
    const { container } = renderSidebar(true)
    const panel = outerEl(container).children[1] as HTMLElement
    expect(panel).toHaveClass('w-[min(320px,85vw)]')
    expect(container.querySelector('.cursor-col-resize')).toBeNull()
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
  })

  it('shows the lock button and the resize handle, and no backdrop', () => {
    act(() => useReaderState.setState({ sidebarOpen: true }))
    const { container } = renderSidebar(false)
    expect(screen.getByTitle('锁定工具栏')).toBeInTheDocument()
    expect(container.querySelector('.cursor-col-resize')).not.toBeNull()
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull()
  })
})
