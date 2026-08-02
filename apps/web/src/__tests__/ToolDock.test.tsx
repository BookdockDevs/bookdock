import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolDock } from '../features/reader/components/ToolDock'

describe('ToolDock', () => {
  it('renders two nav tabs plus the lock button', () => {
    const onNavTab = vi.fn()
    const onToggleLock = vi.fn()

    render(
      <ToolDock activeNavTab="toc" sidebarOpen={true} locked={false} onNavTab={onNavTab} onToggleLock={onToggleLock} />
    )

    expect(screen.getByTitle('目录')).toBeInTheDocument()
    expect(screen.getByTitle('笔记')).toBeInTheDocument()
    expect(screen.getByTitle('锁定工具栏')).toBeInTheDocument()
    expect(screen.queryByTitle('搜索')).toBeNull()
    expect(screen.queryByTitle('书签')).toBeNull()
  })

  it('highlights the active tab when sidebar is open', () => {
    const onNavTab = vi.fn()
    const onToggleLock = vi.fn()

    render(
      <ToolDock activeNavTab="notes" sidebarOpen={true} locked={false} onNavTab={onNavTab} onToggleLock={onToggleLock} />
    )

    expect(screen.getByTitle('笔记')).toHaveClass('border-current', 'text-current')
    expect(screen.getByTitle('目录')).toHaveClass('border-[var(--bd-read-accent)]', 'text-[var(--bd-read-sub)]')
  })

  it('does not highlight any tab when sidebar is closed', () => {
    const onNavTab = vi.fn()
    const onToggleLock = vi.fn()

    render(
      <ToolDock activeNavTab="notes" sidebarOpen={false} locked={false} onNavTab={onNavTab} onToggleLock={onToggleLock} />
    )

    expect(screen.getByTitle('目录')).toHaveClass('border-[var(--bd-read-accent)]', 'text-[var(--bd-read-sub)]')
    expect(screen.getByTitle('笔记')).toHaveClass('border-[var(--bd-read-accent)]', 'text-[var(--bd-read-sub)]')
  })

  it('switches tab when clicking a different button', () => {
    const onNavTab = vi.fn()
    const onToggleLock = vi.fn()

    render(
      <ToolDock activeNavTab="toc" sidebarOpen={true} locked={false} onNavTab={onNavTab} onToggleLock={onToggleLock} />
    )

    fireEvent.click(screen.getByTitle('笔记'))
    expect(onNavTab).toHaveBeenCalledWith('notes')
  })

  it('toggles lock state when clicking the lock button', () => {
    const onNavTab = vi.fn()
    const onToggleLock = vi.fn()

    render(
      <ToolDock activeNavTab="toc" sidebarOpen={true} locked={false} onNavTab={onNavTab} onToggleLock={onToggleLock} />
    )

    fireEvent.click(screen.getByTitle('锁定工具栏'))
    expect(onToggleLock).toHaveBeenCalled()
  })
})
