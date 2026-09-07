import { cn } from '@/lib/utils'
import type { NavTab } from '../types'
import { AiSparkleIcon } from './annotation-icons'

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
      aria-label={title}
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
  statsDisabled?: boolean
  /** Hide the lock action on touch devices, where the dock is transient. */
  hideLock?: boolean
  /** Render the touch toolbar as a labeled horizontal action row. */
  mobile?: boolean
  onNavTab: (tab: NavTab) => void
  onToggleLock: () => void
}

export function ToolDock({ activeNavTab, sidebarOpen, locked, statsDisabled, hideLock, mobile = false, onNavTab, onToggleLock }: ToolDockProps) {
  const icons = [
    {
      id: 'toc' as const,
      title: '目录',
      icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
    },
    {
      id: 'notes' as const,
      title: '笔记',
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
          <path d="M16 8 2 22" />
          <path d="M17.5 15H9" />
        </svg>
      ),
    },
    ...(statsDisabled ? [] : [{
      id: 'stats' as const,
      title: '数据',
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M6 20v-6" />
          <path d="M12 20V9" />
          <path d="M18 20V4" />
        </svg>
      ),
    }] as const),
    {
      id: 'ai' as const,
      title: 'AI 助手',
      icon: <AiSparkleIcon />,
    },
  ]

  return (
    <div className={cn(
      'pointer-events-auto flex',
      mobile ? 'min-w-0 flex-1 items-stretch justify-around gap-1 overflow-x-auto px-1' : 'flex-col gap-2',
    )}>
      {icons.map((item) => {
        const active = sidebarOpen && activeNavTab === item.id
        if (mobile) {
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.title}
              title={item.title}
              onClick={() => onNavTab(item.id)}
              className={cn(
                'flex h-12 min-w-12 flex-1 shrink-0 items-center justify-center rounded-xl transition-colors [&_svg]:h-5 [&_svg]:w-5',
                active ? 'bg-[var(--bd-read-accent)] text-current' : 'text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current',
              )}
            >
              {item.icon}
            </button>
          )
        }
        return <IconButton key={item.id} title={item.title} active={active} onClick={() => onNavTab(item.id)} icon={item.icon} />
      })}
      {!hideLock && (
        <>
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
        </>
      )}
    </div>
  )
}
