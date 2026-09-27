import type { ReactNode } from 'react'

/**
 * The chrome a library row's overflow menu wears: the row's own identity at the
 * top, then items, then an optional danger zone. A private book's menu and a
 * shared library's row menu are the same menu with different items, so the
 * frame lives here and each side supplies only what it can do.
 */
export function MenuHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mx-1.5 mb-1 border-b border-stone-100 px-1.5 pb-2 pt-1.5 dark:border-stone-800">
      <p className="truncate text-xs font-medium text-stone-900 dark:text-stone-100">{title}</p>
      {subtitle && (
        <p className="mt-0.5 truncate text-[10px] text-stone-400 dark:text-stone-500">{subtitle}</p>
      )}
    </div>
  )
}

export function MenuDivider() {
  return <div className="mx-2 my-1 border-t border-stone-100 dark:border-stone-800" />
}

export function MenuItem({ icon, label, onClick }: { icon?: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
    >
      {icon && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
          {icon}
        </svg>
      )}
      {label}
    </button>
  )
}

export function MenuDangerItem({ icon, label, onClick }: { icon?: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
    >
      {icon && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-red-400">
          {icon}
        </svg>
      )}
      {label}
    </button>
  )
}
