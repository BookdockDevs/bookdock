import { cn } from '@/lib/utils'
import type { NavTab } from '../types'
import { AiSparkleIcon } from './annotation-icons'

interface IconButtonProps {
  icon: React.ReactNode
  active?: boolean
  title: string
  onClick: () => void
  ariaPressed?: boolean
}

export function IconButton({ icon, active, title, onClick, ariaPressed }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title}
      aria-pressed={ariaPressed}
      title={title}
      className={cn(
        'relative z-10 pointer-events-auto flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
        active
          ? 'bg-[var(--bd-read-primary)]/15 text-[var(--bd-read-primary)] font-medium'
          : 'text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current',
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
  /** Render compact floating island mode with stacked utility group and divider */
  floating?: boolean
  statsDisabled?: boolean
  guestReadOnly?: boolean
  /** Hide the lock action on touch devices, where the dock is transient. */
  hideLock?: boolean
  /** Render the touch toolbar as a labeled horizontal action row. */
  mobile?: boolean
  onNavTab: (tab: NavTab) => void
  onToggleLock: () => void
  footer?: React.ReactNode
}

export function ToolDock({ activeNavTab, sidebarOpen, locked, floating = false, statsDisabled, guestReadOnly, hideLock, mobile = false, onNavTab, onToggleLock, footer }: ToolDockProps) {
  const icons = [
    {
      id: 'toc' as const,
      title: '目录',
      icon: (
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M4 12h10M4 18h14" />
        </svg>
      ),
    },
    ...(!guestReadOnly ? [{
      id: 'notes' as const,
      title: '笔记',
      icon: (
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
          <path d="M16 8 2 22" />
          <path d="M17.5 15H9" />
        </svg>
      ),
    }] : []),
    ...(statsDisabled ? [] : [{
      id: 'stats' as const,
      title: '数据',
      icon: (
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 20V10" />
          <path d="M12 20V4" />
          <path d="M6 20v-6" />
          <path d="M3 20h18" />
        </svg>
      ),
    }] as const),
    ...(!guestReadOnly ? [{
      id: 'ai' as const,
      title: 'AI 助手',
      icon: <AiSparkleIcon size={18} strokeWidth={1.6} />,
    }] : []),
  ]

  return (
    <div className={cn(
      'relative z-10 pointer-events-auto flex',
      mobile
        ? 'min-w-0 flex-1 items-stretch justify-around gap-1 overflow-x-auto px-1'
        : floating
          ? 'h-auto w-full flex-col items-center gap-1.5'
          : 'h-full w-full flex-col items-center justify-between',
    )}>
      <div className={cn('flex', mobile ? 'contents' : 'flex-col items-center gap-1.5')}>
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
                  active ? 'bg-[var(--bd-read-primary)]/15 text-[var(--bd-read-primary)] font-medium' : 'text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current',
                )}
              >
                {item.icon}
              </button>
            )
          }
          return <IconButton key={item.id} title={item.title} active={active} onClick={() => onNavTab(item.id)} icon={item.icon} />
        })}
      </div>
      {!mobile && (
        <div className={cn('flex flex-col items-center gap-1.5', floating && 'w-full pt-1.5 border-t border-[var(--bd-read-accent)]/60')}>
          {!hideLock && (
            <IconButton
              title={locked ? '取消固定工具栏' : '固定工具栏'}
              ariaPressed={locked}
              onClick={onToggleLock}
              icon={
                <svg
                  className={cn(
                    'h-[18px] w-[18px] transition-transform duration-200',
                    locked ? 'rotate-0 text-current' : '-rotate-45 text-[var(--bd-read-sub)]',
                  )}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="17" x2="12" y2="22" />
                  <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1v3.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                </svg>
              }
            />
          )}
          {footer}
        </div>
      )}
      {mobile && footer}
    </div>
  )
}
