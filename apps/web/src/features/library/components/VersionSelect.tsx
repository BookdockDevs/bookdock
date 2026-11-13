import { useRef, useState } from 'react'

import type { CatalogVersion } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import type { MenuAnchor } from '@/lib/menu-anchor'
import { cn } from '@/lib/utils'

import { versionOrdinal, versionTabLabel } from '../book-row'

interface VersionSelectProps {
  versions: CatalogVersion[]
  selectedId: string | null
  onSelect: (versionLinkId: string) => void
  /** Marks the version the work shows first; omitted where it is irrelevant. */
  defaultVersionId?: string | null
}

/** Bounds shared with the other menus in the app, so a short label does not get a column. */
const MIN_WIDTH = 148
const MAX_WIDTH = 280
/** Item box (13px text + py-2) plus the gap that keeps two highlights from merging. */
const ITEM_HEIGHT = 36
const ITEM_GAP = 4
/** The list scrolls past this, so a work with thirty versions still fits the screen. */
const LIST_MAX_HEIGHT = 320

/**
 * Version picker for a multi-version work, living in the dialog title bar.
 * A tab strip costs horizontal room on every render and stops scaling once a
 * work carries a dozen versions, so the choice became a menu that only spends
 * the space it needs and still names the version on screen. A single version
 * is the work itself, so the trigger disappears entirely.
 */
export default function VersionSelect({ versions, selectedId, onSelect, defaultVersionId }: VersionSelectProps) {
  const _ = useTranslation()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const current = versions.find((version) => version.id === selectedId) ?? versions[0]
  const labelOf = (version: CatalogVersion) =>
    versionTabLabel(version.name, _('library.versionFallback', { n: versionOrdinal(versions, version.id) }))

  if (!current || versions.length <= 1) return null

  function toggle() {
    if (menu) {
      setMenu(null)
      return
    }
    const el = triggerRef.current
    if (!el) return
    setMenu({ kind: 'element', el, placement: 'below', align: 'start' })
  }

  return (
    <div className="relative inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu != null}
        aria-label={_('library.catalogVersions') as string}
        onClick={toggle}
        className="inline-flex h-7 max-w-24 items-center gap-1.5 rounded-lg border border-stone-200/90 bg-white px-2 text-xs font-medium text-stone-600 shadow-2xs transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 sm:max-w-44 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-700 dark:hover:text-stone-100"
      >
        <span className="truncate" title={labelOf(current)}>{labelOf(current)}</span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={cn('shrink-0 text-stone-400 transition-transform duration-150', menu && 'rotate-180')}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {menu && (
        <SmartMenu
          triggerRef={triggerRef}
          innerRef={menuRef}
          anchor={menu}
          onClose={() => setMenu(null)}
          size={{ width: 'auto', height: Math.min(versions.length * (ITEM_HEIGHT + ITEM_GAP) + 8, LIST_MAX_HEIGHT + 8) }}
          minWidth={Math.max(MIN_WIDTH, Math.min(triggerRef.current?.getBoundingClientRect().width ?? MIN_WIDTH, MAX_WIDTH))}
          maxWidth={MAX_WIDTH}
        >
          <div role="menu" aria-label={_('library.catalogVersions') as string} className="flex max-h-80 flex-col gap-1 overflow-y-auto overscroll-contain">
            {versions.map((version) => {
              const active = version.id === current.id
              return (
                <button
                  key={version.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    setMenu(null)
                    if (!active) onSelect(version.id)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                    active
                      ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                      : 'text-stone-700 hover:bg-stone-500/10 dark:text-stone-200 dark:hover:bg-stone-800/70',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate" title={labelOf(version)}>{labelOf(version)}</span>
                  {version.id === defaultVersionId && (
                    <span className="shrink-0 rounded bg-stone-200/80 px-1 py-0.5 text-[10px] font-normal text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                      {_('library.defaultVersion')}
                    </span>
                  )}
                  {active && (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="shrink-0 text-stone-900 dark:text-stone-100"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </SmartMenu>
      )}
    </div>
  )
}
