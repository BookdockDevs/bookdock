import { useState } from 'react'

import { useNavigate } from '@tanstack/react-router'

import type { LibraryListItem } from '@bookdock/shared'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SmartMenu from '@/components/ui/SmartMenu'
import LibraryCreateDialog from '@/features/library/components/LibraryCreateDialog'
import LibraryManageDialog from '@/features/library/components/LibraryManageDialog'
import { useContextMenu } from '@/features/library/components/use-context-menu'
import { applyLibraryOrder } from '@/features/library/dnd'
import { useDeleteLibrary, useHiddenLibraries, useLibraries, useLibraryPrefs, useRemoveLibraryMember } from '@/features/library/hooks'
import { useInstanceInfo } from '@/features/auth/hooks'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import SettingsCard from './SettingsCard'

function LibrariesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="18" rx="1" />
      <rect x="14" y="3" width="7" height="18" rx="1" />
    </svg>
  )
}

/**
 * The libraries the reader belongs to, managed where the account is managed.
 * Discovery of unjoined public libraries is a future home of its own; this
 * list only shows owner/admin/member rows, matching the home sidebar.
 */
export default function LibraryManagementSection() {
  const _ = useTranslation()
  const navigate = useNavigate()
  const currentUserId = useAuthStore((s) => s.user?.id)
  const isInstanceOwner = useAuthStore((s) => s.user?.role) === 'owner'
  const { data: instanceData } = useInstanceInfo()
  // The server enforces this too; hiding the entry point just keeps the UI honest.
  const canCreateLibrary = instanceData?.data.allowUserCreateLibrary !== false || isInstanceOwner
  const { data: librariesData, isLoading, isError, isFetching, refetch } = useLibraries()
  const libraryPrefs = useLibraryPrefs()
  const deleteLibrary = useDeleteLibrary()
  const removeMember = useRemoveLibraryMember()
  const [createOpen, setCreateOpen] = useState(false)
  const [manageTarget, setManageTarget] = useState<LibraryListItem | null>(null)
  const [leaveTarget, setLeaveTarget] = useState<LibraryListItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LibraryListItem | null>(null)

  const memberships = applyLibraryOrder((librariesData?.data ?? []).filter((library) => library.type === 'shared'
    && (library.relation === 'owner' || library.relation === 'admin' || library.relation === 'member')),
  // Same order the sidebar shows. There is no "reset": join-time order is only
  // the starting point, and anything the manual order does not mention (a
  // library joined later) keeps its place at the bottom.
  libraryPrefs?.libraryOrder)
  // Hiding only takes a row out of the reader's sidebar; this table still
  // lists it, so each row's own menu is where it comes back — no separate
  // "hidden" section needed.
  const { isHidden, setHidden } = useHiddenLibraries()
  // The row's relation travels with the list, so reopening the dialog after a
  // role change elsewhere still shows the fresh permissions.
  const manageRelation = manageTarget
    ? (memberships.find((library) => library.id === manageTarget.id)?.relation ?? manageTarget.relation)
    : null

  function enterLibrary(id: string) {
    void navigate({ to: '/', search: { libraryId: id } })
  }

  return (
    <>
      <SettingsCard
        icon={<LibrariesIcon className="h-5 w-5" />}
        iconBgClass="bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
        title={_('library.myLibraries')}
        action={canCreateLibrary && (
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5 shadow-2xs">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{_('library.createLibrary')}</span>
          </Button>
        )}
        bodyClassName="-mx-4 -mb-4 sm:-mx-6 sm:-mb-6 mt-4 overflow-hidden rounded-b-2xl"
      >
        {isLoading ? (
          <div className="space-y-3 p-4 sm:p-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex animate-pulse items-center justify-between py-2.5">
                <div className="space-y-1.5">
                  <div className="h-4 w-28 rounded bg-stone-200/80 dark:bg-stone-800" />
                  <div className="h-3 w-40 rounded bg-stone-100 dark:bg-stone-800/60" />
                </div>
                <div className="h-6 w-16 rounded-md bg-stone-200/80 dark:bg-stone-800" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="p-4 sm:p-6">
            <QueryErrorState isRetrying={isFetching} onRetry={refetch} />
          </div>
        ) : memberships.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-stone-400 sm:px-6 dark:text-stone-500">{_('library.noJoinedLibraries')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm sm:min-w-full">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50/50 text-xs text-stone-400 dark:border-stone-800 dark:bg-stone-800/40">
                  <th className="w-[30%] py-2.5 pl-4 pr-3 font-medium sm:pl-6">{_('library.libraryName')}</th>
                  <th className="w-[18%] py-2.5 px-3 font-medium">{_('library.libraryVisibility')}</th>
                  <th className="w-[16%] py-2.5 px-3 font-medium">{_('library.memberRole')}</th>
                  <th className="w-[14%] py-2.5 px-3 text-right font-medium">{_('library.memberCountLabel')}</th>
                  <th className="w-[14%] py-2.5 px-3 text-right font-medium">{_('library.workCountLabel')}</th>
                  <th className="w-10 py-2.5 pl-3 pr-4 text-right sm:pr-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100/70 dark:divide-stone-800/50">
                {memberships.map((library) => (
                  <LibraryRow
                    key={library.id}
                    library={library}
                    hidden={isHidden(library.id)}
                    onEnter={() => enterLibrary(library.id)}
                    onManage={() => setManageTarget(library)}
                    onLeave={() => setLeaveTarget(library)}
                    onDelete={() => setDeleteTarget(library)}
                    onToggleHidden={() => setHidden(library.id, !isHidden(library.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsCard>

      {createOpen && (
        <LibraryCreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(library) => {
            setCreateOpen(false)
            enterLibrary(library.id)
          }}
        />
      )}

      {manageTarget && (
        <LibraryManageDialog
          library={manageTarget}
          isOwner={manageRelation === 'owner'}
          onClose={() => setManageTarget(null)}
        />
      )}

      {leaveTarget && (
        <ConfirmDialog
          title={_('library.leaveLibrary')}
          message={_('library.leaveLibraryConfirm', { name: leaveTarget.name })}
          confirmLabel={_('library.leaveLibrary')}
          onClose={() => setLeaveTarget(null)}
          onConfirm={() => {
            const target = leaveTarget
            setLeaveTarget(null)
            if (!currentUserId) return
            removeMember.mutate({ libraryId: target.id, userId: currentUserId }, {
              onSuccess: () => notify.success(_('library.leaveLibrarySuccess', { name: target.name })),
              onError: (err) => notify.error(getUserErrorNotification(err, 'library.leaveLibraryFailed')),
            })
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={_('library.deleteLibrary')}
          message={_('library.deleteLibraryConfirm', { name: deleteTarget.name })}
          confirmLabel={_('library.delete')}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget
            setDeleteTarget(null)
            deleteLibrary.mutate({ libraryId: target.id }, {
              onSuccess: () => notify.success(_('library.deleteLibrarySuccess', { name: target.name })),
              onError: (err) => notify.error(getUserErrorNotification(err, 'library.deleteLibraryFailed')),
            })
          }}
        />
      )}
    </>
  )
}

function VisibilityBadge({ visibility }: { visibility?: string | null }) {
  const _ = useTranslation()
  const v = visibility ?? 'private'
  if (v === 'public') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span>{_('library.visibilityPublic')}</span>
      </span>
    )
  }
  if (v === 'password') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="7.5" cy="15.5" r="5.5" />
          <path d="m21 2-9.6 9.6" />
          <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
        </svg>
        <span>{_('library.visibilityPassword')}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <span>{_('library.visibilityPrivate')}</span>
    </span>
  )
}

function LibraryRow({ library, hidden, onEnter, onManage, onLeave, onDelete, onToggleHidden }: {
  library: LibraryListItem
  hidden: boolean
  onEnter: () => void
  onManage: () => void
  onLeave: () => void
  onDelete: () => void
  onToggleHidden: () => void
}) {
  const _ = useTranslation()
  const menu = useContextMenu()

  const isOwnerRow = library.relation === 'owner'
  const canManageRow = isOwnerRow || library.relation === 'admin'
  const canLeaveRow = library.relation === 'admin' || library.relation === 'member'
  const itemCount = (canManageRow ? 1 : 0) + (isOwnerRow ? 1 : 0) + (canLeaveRow ? 1 : 0) + 1

  return (
    <tr
      className="group cursor-pointer transition-colors hover:bg-stone-50/70 dark:hover:bg-stone-800/40"
      onClick={onEnter}
      title={_('library.openLibrary')}
    >
      <td className="py-3 pl-4 pr-3 sm:pl-6">
        <span className="block truncate font-medium text-stone-800 transition-colors group-hover:text-blue-600 dark:text-stone-100 dark:group-hover:text-blue-400">
          {library.name}
        </span>
      </td>
      <td className="py-3 px-3">
        <VisibilityBadge visibility={library.visibility} />
      </td>
      <td className="py-3 px-3">
        <span
          className={cn(
            'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium',
            library.relation === 'owner'
              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
              : library.relation === 'admin'
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                : 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
          )}
        >
          {library.relation === 'owner' ? _('library.relationOwner') : library.relation === 'admin' ? _('library.relationAdmin') : _('library.relationMember')}
        </span>
      </td>
      <td className="py-3 px-3 text-right text-xs tabular-nums text-stone-500 dark:text-stone-400">
        {library.memberCount}
      </td>
      <td className="py-3 px-3 text-right text-xs tabular-nums text-stone-500 dark:text-stone-400">
        {library.workCount}
      </td>
      <td className="py-3 pl-3 pr-4 text-right sm:pr-6" onClick={(e) => e.stopPropagation()}>
        <button
          ref={menu.btnRef}
          type="button"
          aria-label={_('library.moreActions')}
          onClick={() => menu.toggleFromButton()}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>
        <SmartMenu triggerRef={menu.btnRef} innerRef={menu.menuRef} position={menu.position(150, itemCount * 36 + 8)} onClose={menu.close}>
          {canManageRow && (
            <button
              type="button"
              onClick={() => {
                menu.close()
                onManage()
              }}
              className={menuItemClass}
            >              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>{_('library.manageLibrary')}</span>
            </button>
          )}
          {/* Hiding only takes the row out of the reader's sidebar; this table
              still lists it, so the same menu is where it comes back. */}
          <button
            type="button"
            onClick={() => {
              menu.close()
              onToggleHidden()
            }}
            className={menuItemClass}
          >
            {hidden ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            )}
            <span>{hidden ? _('library.show') : _('library.hide')}</span>
          </button>
          {isOwnerRow && (
            <button
              type="button"
              onClick={() => {
                menu.close()
                onDelete()
              }}
              className={cn(menuItemClass, 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-red-500">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>{_('library.delete')}</span>
            </button>
          )}
          {canLeaveRow && (
            <button
              type="button"
              onClick={() => {
                menu.close()
                onLeave()
              }}
              className={cn(menuItemClass, 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-red-500">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>{_('library.leave')}</span>
            </button>
          )}
        </SmartMenu>
      </td>
    </tr>
  )
}

const menuItemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'
