import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/Button'

import MoreActionsMenu, { type MoreActionsMenuItem } from './MoreActionsMenu'
import { ActionIcon } from './ui'

/** `h-8 w-8` on every icon button in the row, including the overflow trigger. */
const ICON_SIZE = 32
/** `gap-2` between the row's top-level items. */
const ROW_GAP = 8
/** `gap-1.5` between the icon buttons themselves. */
const ICON_GAP = 6

export interface DetailAction {
  key: string
  label: string
  /** Icon paths for the inline button; ignored when `node` supplies the control. */
  icon?: ReactNode
  /**
   * A control that cannot be flattened into an icon button (a menu anchor, say).
   * It never folds, because folding it would lose the affordance it opens.
   */
  node?: ReactNode
  onClick?: () => void
  disabled?: boolean
  /** Hover explanation; defaults to the label. */
  title?: string
  /** Secondary enough to move into the overflow menu when the row runs out of room. */
  fold?: boolean
  className?: string
}

export interface DetailPrimaryAction {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  onPointerEnter?: () => void
}

/**
 * The action row under the byline: one primary action, then the icons, then
 * the pinned-right destructive one. Both detail bodies render this instead of
 * their own copy, so the row cannot drift between the private library and a
 * shared one.
 *
 * The row has to end on one line: a delete icon alone on a second line reads as
 * a broken layout, not as a narrow one. So the row measures what it actually
 * has - its own width minus the primary action and the pinned icon - and folds
 * secondary icons into the overflow menu, least important first, until the rest
 * fits. Edit, download and delete are never folded, the delete keeps its own
 * gap from the icons, and a menu is never opened just to hide a single icon.
 *
 * Width inside a wrapping container is the wrong thing to test: the icon group
 * would happily report the space it was given and still wrap, so the demand is
 * computed from the pieces that do not shrink. An unmeasured row (jsdom reports
 * 0) never folds.
 */
export default function DetailActions({
  leading,
  primary,
  actions,
  overflow,
  trailing,
}: {
  /** A badge that qualifies the primary action, e.g. "有更新". */
  leading?: ReactNode
  primary: DetailPrimaryAction
  actions: DetailAction[]
  /** Content-maintenance entries, always in the menu. */
  overflow?: MoreActionsMenuItem[]
  /** Pinned to the right edge: the destructive action. */
  trailing?: ReactNode
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const leadingRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const trailingRef = useRef<HTMLDivElement>(null)
  const [foldCount, setFoldCount] = useState(0)

  // A disabled icon states why it is inert in its tooltip; a menu row cannot
  // carry that, so it stays inline rather than turning into a dead entry.
  const foldable = actions.filter((action) => action.fold && !action.disabled && !action.node)
  const hasOverflow = (overflow?.length ?? 0) > 0

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const measure = () => {
      const available = row.clientWidth
      if (available <= 0) {
        setFoldCount(0)
        return
      }
      const leadingWidth = leadingRef.current?.offsetWidth ?? 0
      const primaryWidth = primaryRef.current?.offsetWidth ?? 0
      const trailingWidth = trailingRef.current?.offsetWidth ?? 0
      const items = 2 + (leadingWidth > 0 ? 1 : 0) + (trailingWidth > 0 ? 1 : 0)
      // What the row spends before a single icon is drawn. The trailing wrapper
      // carries its own left padding, so the measured width already holds the
      // separation that keeps the icons off the delete.
      const reserved = leadingWidth + primaryWidth + trailingWidth + (items - 1) * ROW_GAP
      const iconRowWidth = (icons: number) => {
        if (icons <= 0) return 0
        // The last icon also keeps its gap to the delete, which sits after it.
        const gaps = icons - 1 + (trailingWidth > 0 ? 1 : 0)
        return icons * ICON_SIZE + gaps * ICON_GAP
      }

      // Folding one icon pays for nothing: the overflow trigger then occupies
      // the slot the icon just freed, so the row is no narrower and one more
      // action is hidden. Fold in twos - unless the menu already exists for the
      // content-maintenance entries and the trigger is there either way.
      let folded = -1
      for (let fold = 0; fold <= foldable.length; fold += 1) {
        if (fold === 1 && !hasOverflow) continue
        const menu = hasOverflow || fold > 0
        if (reserved + iconRowWidth(actions.length - fold + (menu ? 1 : 0)) <= available) {
          folded = fold
          break
        }
      }
      setFoldCount(folded < 0 ? foldable.length : folded)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [actions.length, foldable.length, hasOverflow])

  // Least important first: the tail of the declared order folds before the head.
  const folded = foldCount > 0 ? foldable.slice(Math.max(0, foldable.length - foldCount)) : []
  const inline = folded.length === 0 ? actions : actions.filter((action) => !folded.includes(action))
  const menuItems: MoreActionsMenuItem[] = [
    ...folded.map((action) => ({
      key: action.key,
      label: action.label,
      icon: action.icon ?? null,
      onSelect: () => action.onClick?.(),
    })),
    ...(overflow ?? []),
  ]

  return (
    <div ref={rowRef} className="mt-4 flex flex-wrap items-center gap-2">
      {leading && <div ref={leadingRef} className="shrink-0">{leading}</div>}
      <Button
        ref={primaryRef}
        size="sm"
        className="gap-1.5"
        disabled={primary.disabled}
        title={primary.title}
        onPointerEnter={primary.onPointerEnter}
        onClick={primary.onClick}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        {primary.label}
      </Button>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {inline.map((action) => (
          action.node
            ? <div key={action.key} className="shrink-0">{action.node}</div>
            : (
                <ActionIcon
                  key={action.key}
                  secondary
                  label={action.label}
                  title={action.title}
                  disabled={action.disabled}
                  onClick={action.onClick}
                  className={action.className}
                >
                  {action.icon}
                </ActionIcon>
              )
        ))}
        {menuItems.length > 0 && <MoreActionsMenu items={menuItems} />}
        {trailing && <div ref={trailingRef} className="ml-auto pl-3">{trailing}</div>}
      </div>
    </div>
  )
}
