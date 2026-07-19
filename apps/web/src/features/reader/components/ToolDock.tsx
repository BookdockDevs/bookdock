import { cn } from '@/lib/utils'
import type { NavTab } from '../types'

interface IconButtonProps {
  icon: React.ReactNode
  active?: boolean
  title: string
  onClick: () => void
}

export function IconButton({ icon, active, title, onClick }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-lg border bg-[var(--bd-read-bg)] transition-all hover:shadow-md',
        active
          ? 'border-current text-current'
          : 'border-[var(--bd-read-accent)] text-[var(--bd-read-sub)]',
      )}
    >
      {icon}
    </button>
  )
}

interface ToolDockProps {
  activeNavTab: NavTab
  sidebarOpen: boolean
  locked: boolean
  onNavTab: (tab: 'toc' | 'bookmarks' | 'notes' | 'search') => void
  onToggleLock: () => void
}

export function ToolDock({ activeNavTab, sidebarOpen, locked, onNavTab, onToggleLock }: ToolDockProps) {
  const icons = [
    {
      id: 'toc' as const,
      title: '目录',
      icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
    },
    {
      id: 'bookmarks' as const,
      title: '书签',
      icon: (active: boolean) => active ? (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 2h12a2 2 0 012 2v18l-8-4-8 4V4a2 2 0 012-2z" /></svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4h12v16l-6-3-6 3V4z" /></svg>
      ),
    },
    {
      id: 'notes' as const,
      title: '笔记',
      icon: (active: boolean) => active ? (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M16 2H8a2 2 0 00-2 2v16l3.5-1.75L12 20l2.5-1.75L18 20V4a2 2 0 00-2-2z" /></svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 12h6m-6 4h6m2-14H7a2 2 0 00-2 2v16l4-2 4 2 4-2V4a2 2 0 00-2-2z" /></svg>
      ),
    },
    {
      id: 'search' as const,
      title: '搜索',
      icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>,
    },
  ]

  return (
    <div className="pointer-events-auto flex flex-col gap-2">
      {icons.map((item) => {
        const active = sidebarOpen && activeNavTab === item.id
        return (
          <IconButton
            key={item.id}
            title={item.title}
            active={active}
            onClick={() => onNavTab(item.id)}
            icon={typeof item.icon === 'function' ? item.icon(active) : item.icon}
          />
        )
      })}
      <div className="my-1 h-px w-8" style={{ backgroundColor: 'var(--bd-read-accent)' }} />
      <IconButton
        title={locked ? '解锁工具栏' : '锁定工具栏'}
        active={locked}
        onClick={onToggleLock}
        icon={locked ? (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0" /></svg>
        )}
      />
    </div>
  )
}
