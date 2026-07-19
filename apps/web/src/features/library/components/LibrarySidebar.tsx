import { useEffect, useRef, useState } from 'react'

import type { ShelfListItem } from '@bookdock/shared'

import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { useUiStore, type UiTheme } from '@/stores/ui.store'

import { useLibraryState } from '../state/library-state'
import { useBooks, useShelves, useDeleteShelf } from '../hooks'
import DeleteConfirm from './DeleteConfirm'
import ShelfDialog from './ShelfDialog'

export default function LibrarySidebar() {
  const { shelfId, trash, setShelfId, setTrash } = useLibraryState()
  const { data: shelvesData, isLoading: shelvesLoading } = useShelves()
  const uiTheme = useUiStore((s) => s.uiTheme)
  const setUiTheme = useUiStore((s) => s.setUiTheme)

  const shelves = shelvesData?.data ?? []
  const { data: trashData } = useBooks({
    page: 1,
    pageSize: 1,
    search: '',
    sortBy: 'createdAt',
    sortOrder: 'desc',
    shelfId: null,
    tagId: null,
    format: null,
    trash: true,
  })
  const trashCount = trashData?.total

  const [shelfDialog, setShelfDialog] = useState<{ shelfId?: string; initialName?: string } | null>(null)
  const [deleteShelfTarget, setDeleteShelfTarget] = useState<ShelfListItem | null>(null)
  const deleteShelf = useDeleteShelf()

  const isAllActive = !shelfId && !trash

  const themeOptions: { value: UiTheme; icon: string; title: string }[] = [
    { value: 'system', icon: '💻', title: '跟随系统' },
    { value: 'light', icon: '☀', title: '日间' },
    { value: 'dark', icon: '🌙', title: '夜间' },
  ]

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-stone-100 px-4 py-6 dark:border-stone-800/50 md:flex">
      <div className="mb-8 flex items-center gap-2">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-700 dark:text-stone-200">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
          <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
        </svg>
        <span className="font-serif text-sm font-medium text-stone-900 dark:text-stone-100">书坞</span>
      </div>

      <nav className="flex flex-col">
        <NavItem label={t().library.allBooks} active={isAllActive} onClick={() => { setShelfId(null); setTrash(false) }} />

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between px-3">
            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
              {t().library.shelves}
            </span>
            <button
              type="button"
              onClick={() => setShelfDialog({})}
              className="flex items-center text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
              title={t().library.newShelf}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
          {shelvesLoading ? (
            <div className="px-3 py-2 text-xs text-stone-400">{t().reader.loading}</div>
          ) : shelves.length === 0 ? (
            <div className="px-3 text-xs text-stone-400">{t().library.noShelves}</div>
          ) : (
            <div className="flex flex-col">
              {shelves.map((shelf) => (
                <ShelfItem
                  key={shelf.id}
                  shelf={shelf}
                  active={!trash && shelfId === shelf.id}
                  onClick={() => setShelfId(shelf.id)}
                  onRename={() => setShelfDialog({ shelfId: shelf.id, initialName: shelf.name })}
                  onDelete={() => setDeleteShelfTarget(shelf)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-6">
          <NavItem
            label={t().library.trash}
            count={trashCount}
            active={trash}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
              </svg>
            }
            onClick={() => setTrash(true)}
          />
        </div>
      </nav>

      <div className="mt-auto pt-6">
        <div className="inline-flex items-center gap-1 rounded-lg border border-stone-200 p-1 dark:border-stone-800">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              title={opt.title}
              onClick={() => setUiTheme(opt.value)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors',
                uiTheme === opt.value
                  ? 'bg-stone-200 text-stone-900 dark:bg-stone-700 dark:text-stone-100'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-100',
              )}
            >
              {opt.icon}
            </button>
          ))}
        </div>
      </div>

      <ShelfDialog
        open={shelfDialog !== null}
        shelfId={shelfDialog?.shelfId}
        initialName={shelfDialog?.initialName}
        onClose={() => setShelfDialog(null)}
      />

      <DeleteConfirm
        open={deleteShelfTarget !== null}
        title={t().library.deleteShelf}
        message={`${t().library.deleteShelfConfirm}（${deleteShelfTarget?.name ?? ''}）`}
        confirmLabel={t().reader.delete}
        onCancel={() => setDeleteShelfTarget(null)}
        onConfirm={() => {
          const target = deleteShelfTarget
          if (!target) return
          setDeleteShelfTarget(null)
          if (shelfId === target.id) setShelfId(null)
          void deleteShelf.mutateAsync(target.id).catch(() => undefined)
        }}
      />
    </aside>
  )
}

function NavItem({
  label,
  count,
  active = false,
  icon,
  onClick,
}: {
  label: string
  count?: number
  active?: boolean
  icon?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
        active
          ? 'font-medium text-stone-900 dark:text-stone-100'
          : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-100',
      )}
    >
      <span className="flex items-center gap-2">
        {active && (
          <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-stone-900 dark:bg-stone-100" />
        )}
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {count !== undefined && count > 0 && (
        <span className="text-xs text-stone-400">{count}</span>
      )}
    </button>
  )
}

function ShelfItem({
  shelf,
  active,
  onClick,
  onRename,
  onDelete,
}: {
  shelf: ShelfListItem
  active: boolean
  onClick: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [menuOpen])

  return (
    <div className="group relative">
      <NavItem label={shelf.name} count={shelf.bookCount} active={active} onClick={onClick} />
      <div ref={menuRef} className="absolute right-1 top-1/2 -translate-y-1/2">
        <button
          type="button"
          aria-label={t().library.filter}
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition-opacity hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200',
            menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-7 z-20 w-28 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onRename()
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-xs text-stone-600 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              {t().library.renameShelf}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onDelete()
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-xs text-red-600 hover:bg-stone-50 dark:hover:bg-stone-800"
            >
              {t().library.deleteShelf}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
