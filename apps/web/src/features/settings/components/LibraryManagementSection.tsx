import { useState } from 'react'

import { useNavigate } from '@tanstack/react-router'

import type { LibraryListItem } from '@bookdock/shared'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SmartMenu from '@/components/ui/SmartMenu'
import JoinLibraryDialog from '@/features/library/components/JoinLibraryDialog'
import LibraryCreateDialog from '@/features/library/components/LibraryCreateDialog'
import LibraryDiscoveryDialog from '@/features/library/components/LibraryDiscoveryDialog'
import LibraryManageDialog from '@/features/library/components/LibraryManageDialog'
import { useContextMenu } from '@/features/library/components/use-context-menu'
import { useLibraries, useRemoveLibraryMember } from '@/features/library/hooks'
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
  const { data: librariesData, isLoading, isError, isFetching, refetch } = useLibraries()
  const removeMember = useRemoveLibraryMember()
  const [createOpen, setCreateOpen] = useState(false)
  const [discoveryOpen, setDiscoveryOpen] = useState(false)
  const [joinTarget, setJoinTarget] = useState<LibraryListItem | null>(null)
  const [manageTarget, setManageTarget] = useState<LibraryListItem | null>(null)
  const [leaveTarget, setLeaveTarget] = useState<LibraryListItem | null>(null)

  const memberships = (librariesData?.data ?? []).filter((library) => library.type === 'shared'
    && (library.relation === 'owner' || library.relation === 'admin' || library.relation === 'member'))
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
        action={(
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDiscoveryOpen(true)}>
              {_('library.exploreLibraries')}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              {_('library.createLibrary')}
            </Button>
          </div>
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
            <table className="w-full min-w-[28rem] text-left text-sm sm:min-w-full">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50/50 text-xs text-stone-400 dark:border-stone-800 dark:bg-stone-800/40">
                  <th className="w-[46%] py-2.5 pl-4 pr-3 font-medium sm:pl-6">{_('library.libraryName')}</th>
                  <th className="w-[22%] py-2.5 px-3 font-medium">{_('library.libraryVisibility')}</th>
                  <th className="w-[22%] py-2.5 px-3 font-medium">{_('library.memberRole')}</th>
                  <th className="w-10 py-2.5 pl-3 pr-4 text-right sm:pr-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100/70 dark:divide-stone-800/50">
                {memberships.map((library) => (
                  <LibraryRow
                    key={library.id}
                    library={library}
                    onEnter={() => enterLibrary(library.id)}
                    onManage={() => setManageTarget(library)}
                    onLeave={() => setLeaveTarget(library)}
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
          canManage={manageRelation === 'owner' || manageRelation === 'admin'}
          isOwner={manageRelation === 'owner'}
          onClose={() => setManageTarget(null)}
          onDeleted={() => setManageTarget(null)}
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

      {discoveryOpen && (
        <LibraryDiscoveryDialog
          open
          onClose={() => setDiscoveryOpen(false)}
          onSelectLibrary={(id) => {
            setDiscoveryOpen(false)
            enterLibrary(id)
          }}
          onJoinWithPassword={(lib) => {
            setJoinTarget(lib)
          }}
        />
      )}

      {joinTarget && (
        <JoinLibraryDialog
          open
          libraryId={joinTarget.id}
          libraryName={joinTarget.name}
          needsPassword={joinTarget.visibility === 'password'}
          onClose={() => setJoinTarget(null)}
        />
      )}
    </>
  )
}

function LibraryRow({ library, onEnter, onManage, onLeave }: {
  library: LibraryListItem
  onEnter: () => void
  onManage: () => void
  onLeave: () => void
}) {
  const _ = useTranslation()
  const menu = useContextMenu()

  const canManageRow = library.relation === 'owner' || library.relation === 'admin'
  const canLeaveRow = library.relation === 'admin' || library.relation === 'member'

  return (
    <tr
      className="cursor-pointer transition-colors hover:bg-stone-50/50 dark:hover:bg-stone-800/30"
      onClick={onEnter}
    >
      <td className="py-3 pl-4 pr-3 sm:pl-6">
        <span className="block truncate font-medium text-stone-800 dark:text-stone-100">{library.name}</span>
      </td>
      <td className="py-3 px-3 text-stone-500 dark:text-stone-400">{_(`library.visibility${capitalize(library.visibility ?? 'private')}`)}</td>
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
        <SmartMenu triggerRef={menu.btnRef} innerRef={menu.menuRef} position={menu.position(176, canManageRow && canLeaveRow ? 112 : 76)} onClose={menu.close}>
          <button
            type="button"
            onClick={() => {
              menu.close()
              onEnter()
            }}
            className={menuItemClass}
          >
            {_('library.openLibrary')}
          </button>
          {canManageRow && (
            <button
              type="button"
              onClick={() => {
                menu.close()
                onManage()
              }}
              className={menuItemClass}
            >
              {_('library.manageLibrary')}
            </button>
          )}
          {canLeaveRow && (
            <button
              type="button"
              onClick={() => {
                menu.close()
                onLeave()
              }}
              className={menuItemClass}
            >
              {_('library.leaveLibrary')}
            </button>
          )}
        </SmartMenu>
      </td>
    </tr>
  )
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const menuItemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'
