import { useMemo } from 'react'
import type { ReactNode } from 'react'

import type { StorageConnectionRes } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useContextMenu } from '@/features/library/components/use-context-menu'
import { computeDropdownPosition, type SmartPosition } from '@/lib/position'
import { cn } from '@/lib/utils'

import LocalStorageBadge from './LocalStorageBadge'
import { PROVIDER_MARK } from './storageProviderMark'

export interface StorageConnectionPickerProps {
  connections: StorageConnectionRes[]
  value: string
  onChange: (id: string) => void
  showLocalOption?: boolean
  localLabel?: string
  onAddNew?: () => void
  addNewLabel?: ReactNode
  triggerClassName?: string
  triggerNameClassName?: string
  menuWidth?: number | 'auto'
  menuClassName?: string
  ariaLabel?: string
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-600 dark:text-stone-300">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

const optionButtonClass = (selected: boolean) => cn(
  'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer',
  selected
    ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
    : 'text-stone-600 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100',
)

export default function StorageConnectionPicker({
  connections,
  value,
  onChange,
  showLocalOption = false,
  localLabel = '本地磁盘',
  onAddNew,
  addNewLabel = '添加存储',
  triggerClassName,
  triggerNameClassName = 'max-w-[140px]',
  menuWidth = 'auto',
  menuClassName,
  ariaLabel,
}: StorageConnectionPickerProps) {
  const menu = useContextMenu()
  const selected = connections.find((c) => c.id === value)
  const isLocal = showLocalOption && value === 'local'

  const anchor = menu.btnRef.current?.getBoundingClientRect()
  const resolvedWidth = menuWidth === 'auto'
    ? Math.max(160, Math.min(260, anchor?.width ?? 200))
    : menuWidth
  const rowCount = (showLocalOption ? 1 : 0) + connections.length + (onAddNew ? 1 : 0)
  const estimatedHeight = Math.min(240, rowCount * 34 + 16)
  // Dropdown selects open directly below the trigger (left-aligned,
  // right-clamped into the viewport). The shared context-menu placement
  // prefers the side of the anchor, which looks detached for selects.
  const position: SmartPosition | null = useMemo(() => {
    if (!menu.open || !anchor) return null
    return computeDropdownPosition(anchor, resolvedWidth, estimatedHeight)
  }, [menu.open, anchor, resolvedWidth, estimatedHeight])

  function handleSelect(id: string) {
    onChange(id)
    menu.close()
  }

  return (
    <>
      <button
        ref={menu.btnRef}
        type="button"
        onClick={menu.toggleFromButton}
        aria-haspopup="listbox"
        aria-expanded={menu.open}
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-800 shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700/60',
          menu.open && 'border-stone-400 dark:border-stone-500',
          triggerClassName,
        )}
      >
        {isLocal ? (
          <LocalStorageBadge />
        ) : selected && PROVIDER_MARK[selected.provider] ? (
          <span className="shrink-0" title={PROVIDER_MARK[selected.provider].label}>
            {PROVIDER_MARK[selected.provider].badge}
          </span>
        ) : (
          <LocalStorageBadge />
        )}
        <span className={cn('truncate', triggerNameClassName)} title={isLocal ? localLabel : (selected?.name || value)}>
          {isLocal ? localLabel : (selected?.name || value)}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('shrink-0 text-stone-400 transition-transform dark:text-stone-500', menu.open && 'rotate-180')}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {menu.open && (
        <SmartMenu
          triggerRef={menu.btnRef}
          innerRef={menu.menuRef}
          position={position}
          onClose={menu.close}
          width={resolvedWidth}
          className={menuClassName}
        >
          <div className="max-h-56 overflow-y-auto overscroll-contain py-1">
            {showLocalOption && (
              <button type="button" onClick={() => handleSelect('local')} className={optionButtonClass(isLocal)}>
                <div className="flex items-center gap-2 truncate">
                  <LocalStorageBadge />
                  <span className="truncate">{localLabel}</span>
                </div>
                {isLocal && <CheckIcon />}
              </button>
            )}

            {showLocalOption && connections.length > 0 && (
              <div className="my-1 border-t border-stone-100 dark:border-stone-800" />
            )}

            {connections.map((c) => {
              const isSelected = value === c.id
              return (
                <button key={c.id} type="button" onClick={() => handleSelect(c.id)} className={optionButtonClass(isSelected)}>
                  <div className="flex items-center gap-2 truncate">
                    <span className="shrink-0" title={PROVIDER_MARK[c.provider]?.label ?? c.provider}>
                      {PROVIDER_MARK[c.provider]?.badge ?? (
                        <span className="inline-flex h-[18px] min-w-[28px] items-center justify-center rounded border border-stone-200/70 bg-stone-100 px-1 text-[10px] font-bold text-stone-700 dark:border-stone-700/70 dark:bg-stone-800 dark:text-stone-300">
                          {c.provider.slice(0, 3).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="truncate" title={c.name}>{c.name}</span>
                  </div>
                  {isSelected && <CheckIcon />}
                </button>
              )
            })}

            {onAddNew && (
              <>
                <div className="my-1 border-t border-stone-100 dark:border-stone-800" />
                <button
                  type="button"
                  onClick={() => {
                    menu.close()
                    onAddNew()
                  }}
                  className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-stone-500 transition-colors hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100 cursor-pointer"
                >
                  <span className="inline-flex h-[18px] min-w-[28px] shrink-0 items-center justify-center rounded border border-dashed border-stone-300 bg-stone-50/60 text-stone-400 transition-colors group-hover:border-stone-400 group-hover:text-stone-600 dark:border-stone-700 dark:bg-stone-800/40 dark:text-stone-500 dark:group-hover:border-stone-600 dark:group-hover:text-stone-300">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                  <span className="truncate">{addNewLabel}</span>
                </button>
              </>
            )}
          </div>
        </SmartMenu>
      )}
    </>
  )
}
