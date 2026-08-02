import { memo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import type { ShelfListItem } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import type { LibrarySearch } from '@/routes/index'
import SmartMenu from '@/components/ui/SmartMenu'
import AccountMenu from '@/features/auth/AccountMenu'
import { useBooks, useShelves, useTags, useDeleteShelf } from '../hooks'
import DeleteConfirm from './DeleteConfirm'
import ShelfDialog from './ShelfDialog'
import { useContextMenu } from './use-context-menu'

interface LibrarySidebarProps {
  navSearch: (patch: Partial<LibrarySearch>) => void
  shelfId: string | null
  tagId: string | null
  trash: boolean
}

const LibrarySidebar = memo(function LibrarySidebar({ navSearch, shelfId, tagId, trash }: LibrarySidebarProps) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const { data: shelvesData, isLoading: shelvesLoading } = useShelves()
  const { data: tagsData } = useTags()

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
    readStatus: null,
    trash: true,
  })
  const trashCount = trashData?.total

  const [shelfDialog, setShelfDialog] = useState<{ shelfId?: string; initialName?: string } | null>(null)
  const [deleteShelfTarget, setDeleteShelfTarget] = useState<ShelfListItem | null>(null)
  const deleteShelf = useDeleteShelf()

  const isAllActive = !shelfId && !tagId && !trash

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-stone-200/60 px-3 py-6 dark:border-stone-800/50 md:flex">
      <div className="mb-8 flex items-center gap-2.5 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
            <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
          </svg>
        </span>
        <span className="font-serif text-base font-semibold tracking-wide text-stone-900 dark:text-stone-50">{_('app.name')}</span>
      </div>

      <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        <NavItem
          label={_('library.allBooks')}
          active={isAllActive}
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          }
          onClick={() => navSearch({ shelf: undefined, tag: undefined, status: undefined, trash: undefined })}
        />

        <div className="mb-1 mt-6 flex items-center justify-between px-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            {_('library.shelves')}
          </span>
          <button
            type="button"
            onClick={() => setShelfDialog({})}
            className="flex h-5 w-5 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            title={_('library.newShelf')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        {shelvesLoading ? (
          <div className="px-3 py-2 text-xs text-stone-400">{_('reader.loading')}</div>
        ) : shelves.length === 0 ? (
          <div className="px-3 py-1 text-xs text-stone-400">{_('library.noShelves')}</div>
        ) : (
          shelves.map((shelf) => (
            <ShelfItem
              key={shelf.id}
              shelf={shelf}
              active={!trash && shelfId === shelf.id}
              onClick={() => navSearch({ shelf: shelf.id, tag: undefined, status: undefined, trash: undefined })}
              onRename={() => setShelfDialog({ shelfId: shelf.id, initialName: shelf.name })}
              onDelete={() => setDeleteShelfTarget(shelf)}
            />
          ))
        )}

        <div className="mb-1 mt-6 flex items-center justify-between px-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            {_('library.tags')}
          </span>
        </div>
        {(tagsData?.data ?? []).length === 0 ? (
          <div className="px-3 py-1 text-xs text-stone-400">{_('library.noTags')}</div>
        ) : (
          (tagsData?.data ?? []).map((tag) => (
            <NavItem
              key={tag.id}
              label={tag.name}
              count={tag.bookCount}
              active={!trash && tagId === tag.id}
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42z" />
                  <circle cx="7" cy="7" r="1" />
                </svg>
              }
              onClick={() => navSearch({ tag: tag.id, shelf: undefined, status: undefined, trash: undefined })}
            />
          ))
        )}

        <div className="mt-6 border-t border-stone-200/60 pt-4 dark:border-stone-800/50">
          <NavItem
            label={_('library.trash')}
            count={trashCount}
            active={trash}
            icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
              </svg>
            }
            onClick={() => navSearch({ trash: true, shelf: undefined, tag: undefined, status: undefined })}
          />
        </div>
      </nav>

      <div className="mt-auto px-2 pt-6">
        <NavItem
          label={_('stats.title')}
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <rect x="7" y="12" width="3" height="6" rx="1" />
              <rect x="12" y="8" width="3" height="10" rx="1" />
              <rect x="17" y="4" width="3" height="14" rx="1" />
            </svg>
          }
          onClick={() => void navigate({ to: '/stats' })}
        />
        <NavItem
          label={_('settings.title')}
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          }
          onClick={() => void navigate({ to: '/settings' })}
        />
        <div className="mt-1">
          <AccountMenu />
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
        title={_('library.deleteShelf')}
        message={_('library.deleteShelfConfirm', { name: deleteShelfTarget?.name ?? '' })}
        confirmLabel={_('reader.delete')}
        onCancel={() => setDeleteShelfTarget(null)}
        onConfirm={() => {
          const target = deleteShelfTarget
          if (!target) return
          setDeleteShelfTarget(null)
          if (shelfId === target.id) navSearch({ shelf: undefined, tag: undefined, status: undefined, trash: undefined })
          void deleteShelf.mutateAsync(target.id).catch(() => undefined)
        }}
      />
    </aside>
  )
})

export default LibrarySidebar

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
        'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-all',
        active
          ? 'bg-white font-medium text-stone-900 shadow-sm ring-1 ring-stone-200/70 dark:bg-stone-900 dark:text-stone-50 dark:ring-stone-800'
          : 'text-stone-500 hover:bg-stone-200/50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/50 dark:hover:text-stone-100',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {icon && <span className={cn('shrink-0', active ? 'text-stone-700 dark:text-stone-300' : 'text-stone-400 dark:text-stone-500')}>{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      {count !== undefined && count > 0 && (
        <span className="ml-2 shrink-0 text-xs tabular-nums text-stone-400 transition-opacity group-hover:opacity-0 dark:text-stone-500">{count}</span>
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
  const _ = useTranslation()
  const menu = useContextMenu()

  return (
    <div
      className="group relative"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        menu.openFromEvent(e)
      }}
    >
      <NavItem
        label={shelf.name}
        count={shelf.bookCount}
        active={active}
        icon={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        }
        onClick={onClick}
      />
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
        <button
          ref={menu.btnRef}
          type="button"
          aria-label={_('library.moreActions')}
          onClick={(e) => {
            e.stopPropagation()
            menu.openFromButton()
          }}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition-all hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200',
            menu.open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
      </div>
      <SmartMenu innerRef={menu.menuRef} position={menu.position(152, 148)} onClose={menu.close} width={152}>
        <div className="mx-1.5 mb-1 border-b border-stone-100 px-1.5 pb-2 pt-1.5 dark:border-stone-800">
          <p className="truncate text-xs font-medium text-stone-900 dark:text-stone-100">{shelf.name}</p>
          <p className="mt-0.5 text-[10px] text-stone-400 dark:text-stone-500">
            {_('library.bookCount', { count: shelf.bookCount })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            menu.close()
            onRename()
          }}
          className={shelfMenuItemClass}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          {_('library.rename')}
        </button>
        <button
          type="button"
          onClick={() => {
            menu.close()
            onDelete()
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-red-400">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
          </svg>
          {_('library.delete')}
        </button>
      </SmartMenu>
    </div>
  )
}

const shelfMenuItemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'
