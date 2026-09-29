import { useEffect, useMemo, useRef, useState } from 'react'

import { AUTH_PASSWORD_MIN_LENGTH, AUTH_REGISTER_USERNAME_MAX_LENGTH, sanitizeUsername } from '@bookdock/shared'
import type { AdminUserRes, LibraryListItem, LibraryMemberEntry, MembershipRole, UpdateUserReq } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SmartMenu from '@/components/ui/SmartMenu'
import { useAdminUsers, useCreateUser, useDeleteUser, useTransferInstanceOwnership, useUpdateUser } from '@/features/auth/hooks'
import { useContextMenu } from '@/features/library/components/use-context-menu'
import {
  useLibraries,
  useLibraryMembers,
  useRemoveLibraryMember,
  useSetLibraryMemberRole,
  useTransferLibrary,
} from '@/features/library/hooks'
import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'
import { getUserErrorNotification } from '@/lib/error-message'
import { formatDate } from '@/lib/format-date'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import SettingsCard from './SettingsCard'

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function EyeToggleIcon({ show }: { show: boolean }) {
  if (show) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
        <line x1="2" y1="2" x2="22" y2="22" />
      </svg>
    )
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function MemberAvatar({
  username,
  avatarKey,
  isOwner,
}: {
  username: string
  avatarKey?: string | null
  isOwner?: boolean
}) {
  const [loadFailed, setLoadFailed] = useState(false)
  const url = avatarUrl(avatarKey)

  if (url && !loadFailed) {
    return (
      <img
        src={url}
        alt={username}
        onError={() => setLoadFailed(true)}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
    )
  }

  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        isOwner
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-bold'
          : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
      )}
    >
      {username.slice(0, 1).toUpperCase()}
    </span>
  )
}

function RoleBadge({ role }: { role: 'owner' | 'admin' | 'member' | 'guest' }) {
  const _ = useTranslation()
  const styles: Record<'owner' | 'admin' | 'member' | 'guest', string> = {
    owner: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
    admin: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
    member: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    guest: 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
  }
  const labels: Record<'owner' | 'admin' | 'member' | 'guest', string> = {
    owner: _('auth.roleOwner'),
    admin: _('library.relationAdmin'),
    member: _('auth.roleMember'),
    guest: _('auth.guest'),
  }

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', styles[role])}>
      {labels[role]}
    </span>
  )
}

const menuItemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'

interface PendingAction {
  user: AdminUserRes
  req: UpdateUserReq
  title: string
  message: string
}

function LibrarySelectDropdown({
  libraries,
  selectedId,
  onSelect,
  selectAriaLabel,
}: {
  libraries: LibraryListItem[]
  selectedId?: string
  onSelect: (id: string) => void
  selectAriaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedLibrary = libraries.find((l) => l.id === selectedId) || libraries[0]

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={selectAriaLabel}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-800 shadow-2xs transition-colors hover:border-stone-300 hover:bg-stone-50/50 dark:border-stone-700 dark:bg-stone-800/90 dark:text-stone-100 dark:hover:border-stone-600',
          open && 'border-stone-300 ring-2 ring-stone-200/50 dark:border-stone-600 dark:ring-stone-700/50',
        )}
      >
        <span className="max-w-[120px] truncate sm:max-w-[170px]">
          {selectedLibrary?.name}
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
          className={cn('shrink-0 text-stone-400 transition-transform duration-150', open && 'rotate-180 text-stone-600 dark:text-stone-300')}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 min-w-[180px] max-w-[260px] overflow-hidden rounded-xl border border-stone-200 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/95 animate-in fade-in zoom-in-95 duration-100">
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {libraries.map((lib) => {
              const isSelected = lib.id === selectedLibrary?.id
              return (
                <button
                  key={lib.id}
                  type="button"
                  onClick={() => {
                    onSelect(lib.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                    isSelected
                      ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                      : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-200',
                  )}
                >
                  <span className="truncate">{lib.name}</span>
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-900 dark:text-stone-100" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

interface UserManagementSectionProps {
  initialTab?: 'instance' | 'library'
  initialLibraryId?: string
  lockTab?: 'instance' | 'library'
}

export default function UserManagementSection({
  initialTab = 'instance',
  initialLibraryId,
  lockTab,
}: UserManagementSectionProps = {}) {
  const _ = useTranslation()
  const [tab, setTab] = useState<'instance' | 'library'>(lockTab ?? initialTab)
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | undefined>(initialLibraryId)
  const [createOpen, setCreateOpen] = useState(false)
  const { data: librariesData } = useLibraries()

  const sharedLibraries = (librariesData?.data ?? []).filter(
    (l) => l.type === 'shared' && (l.relation === 'owner' || l.relation === 'admin'),
  )

  const activeLibraryId = selectedLibraryId && sharedLibraries.some((l) => l.id === selectedLibraryId)
    ? selectedLibraryId
    : sharedLibraries[0]?.id

  useEffect(() => {
    if (lockTab) setTab(lockTab)
    else if (initialTab) setTab(initialTab)
  }, [initialTab, lockTab])

  useEffect(() => {
    if (initialLibraryId) setSelectedLibraryId(initialLibraryId)
  }, [initialLibraryId])

  useEffect(() => {
    if (!selectedLibraryId && sharedLibraries[0]?.id) {
      setSelectedLibraryId(sharedLibraries[0].id)
    }
  }, [selectedLibraryId, sharedLibraries])

  return (
    <SettingsCard
      icon={<UsersIcon className="h-5 w-5" />}
      iconBgClass="bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
      title={_('admin.userManagement')}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-2.5">
          {!lockTab && (
            <div className="flex h-8 items-center rounded-xl bg-stone-100 p-0.5 dark:bg-stone-800">
              <button
                type="button"
                onClick={() => setTab('instance')}
                className={cn(
                  'flex h-7 items-center rounded-lg px-2.5 text-xs font-medium transition-all',
                  tab === 'instance'
                    ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-900 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200',
                )}
              >
                {_('admin.userTabInstance')}
              </button>
              <button
                type="button"
                onClick={() => setTab('library')}
                className={cn(
                  'flex h-7 items-center rounded-lg px-2.5 text-xs font-medium transition-all',
                  tab === 'library'
                    ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-900 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200',
                )}
              >
                {_('admin.userTabLibrary')}
              </button>
            </div>
          )}

          {!lockTab && (tab === 'instance' || (tab === 'library' && sharedLibraries.length > 0)) && (
            <div className="hidden h-4 w-px bg-stone-200 sm:block dark:bg-stone-700" />
          )}

          {tab === 'instance' && (
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5 shadow-2xs">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>{_('admin.createUser')}</span>
            </Button>
          )}

          {tab === 'library' && sharedLibraries.length > 0 && (
            <LibrarySelectDropdown
              libraries={sharedLibraries}
              selectedId={activeLibraryId}
              onSelect={(id) => setSelectedLibraryId(id)}
              selectAriaLabel={_('admin.selectLibrary')}
            />
          )}
        </div>
      }
      bodyClassName="-mx-4 -mb-4 sm:-mx-6 sm:-mb-6 mt-4 overflow-hidden rounded-b-2xl"
    >
      {tab === 'instance' ? (
        <InstanceUsersView createOpen={createOpen} setCreateOpen={setCreateOpen} />
      ) : (
        <LibraryMembersView
          activeLibraryId={activeLibraryId}
          hasManageableLibraries={sharedLibraries.length > 0}
        />
      )}
    </SettingsCard>
  )
}

function InstanceUsersView({
  createOpen,
  setCreateOpen,
}: {
  createOpen: boolean
  setCreateOpen: (open: boolean) => void
}) {
  const _ = useTranslation()
  const currentUser = useAuthStore((s) => s.user)
  const { data: usersData, isError, isFetching, isLoading, refetch } = useAdminUsers()
  const updateUser = useUpdateUser()
  const createUser = useCreateUser()
  const deleteUser = useDeleteUser()
  const transferOwnership = useTransferInstanceOwnership()
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [transferTarget, setTransferTarget] = useState<AdminUserRes | null>(null)
  const [resetTarget, setResetTarget] = useState<AdminUserRes | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRes | null>(null)

  const users = useMemo(() => {
    const list = [...(usersData?.data ?? [])]
    const ROLE_WEIGHT: Record<string, number> = { owner: 0, admin: 1, member: 2 }
    return list.sort((a, b) => {
      const weightA = ROLE_WEIGHT[a.role] ?? 3
      const weightB = ROLE_WEIGHT[b.role] ?? 3
      if (weightA !== weightB) return weightA - weightB
      return a.createdAt - b.createdAt
    })
  }, [usersData?.data])

  function runUpdate(id: string, req: UpdateUserReq) {
    updateUser.mutate(
      { id, ...req },
      { onError: (err) => notify.error(getUserErrorNotification(err, 'auth.errors.userUpdateFailed')) },
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4 sm:p-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex animate-pulse items-center justify-between py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-full bg-stone-200/80 dark:bg-stone-800" />
              <div className="space-y-1.5">
                <div className="h-4 w-28 rounded bg-stone-200/80 dark:bg-stone-800" />
                <div className="h-3 w-40 rounded bg-stone-100 dark:bg-stone-800/60" />
              </div>
            </div>
            <div className="h-6 w-16 rounded-md bg-stone-200/80 dark:bg-stone-800" />
          </div>
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4 sm:p-6">
        <QueryErrorState isRetrying={isFetching} onRetry={refetch} />
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm sm:min-w-full">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50/50 text-xs text-stone-400 dark:border-stone-800 dark:bg-stone-800/40">
              <th className="w-[30%] py-2.5 pl-4 pr-3 font-medium sm:pl-6">{_('auth.username')}</th>
              <th className="w-[18%] py-2.5 px-3 font-medium">{_('admin.role')}</th>
              <th className="w-[14%] py-2.5 px-3 font-medium">{_('admin.bookCount')}</th>
              <th className="w-[14%] py-2.5 px-3 font-medium">{_('admin.status')}</th>
              <th className="w-[20%] py-2.5 px-3 whitespace-nowrap font-medium">{_('admin.createdAt')}</th>
              <th className="w-10 py-2.5 pl-3 pr-4 text-right sm:pr-6" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100/70 dark:divide-stone-800/50">
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isSelf={user.id === currentUser?.id}
                onAction={setPendingAction}
                onTransfer={setTransferTarget}
                onResetPassword={setResetTarget}
                onDelete={setDeleteTarget}
              />
            ))}
          </tbody>
        </table>
      </div>

      {pendingAction && (
        <ConfirmDialog
          title={pendingAction.title}
          message={pendingAction.message}
          confirmLabel={_('admin.confirm')}
          confirmVariant="danger"
          onClose={() => setPendingAction(null)}
          onConfirm={() => {
            const action = pendingAction
            setPendingAction(null)
            runUpdate(action.user.id, action.req)
          }}
        />
      )}

      {transferTarget && (
        <ConfirmDialog
          title={_('admin.transferOwner')}
          message={_('admin.transferOwnerConfirm', { name: transferTarget.username })}
          confirmLabel={_('admin.transferOwner')}
          onClose={() => setTransferTarget(null)}
          onConfirm={() => {
            const target = transferTarget
            setTransferTarget(null)
            transferOwnership.mutate(target.id, {
              onSuccess: () => notify.success(_('admin.transferOwnerSuccess', { name: target.username })),
              onError: (err) => notify.error(getUserErrorNotification(err, 'admin.transferOwnerFailed')),
            })
          }}
        />
      )}

      <ResetPasswordDialog
        user={resetTarget}
        onClose={() => setResetTarget(null)}
        onSubmit={(password) => {
          const target = resetTarget
          setResetTarget(null)
          if (target) runUpdate(target.id, { newPassword: password })
        }}
      />

      {createOpen && (
        <CreateUserDialog
          onClose={() => setCreateOpen(false)}
          onSubmit={(username, password) => {
            setCreateOpen(false)
            createUser.mutate({ username, password }, {
              onSuccess: (res) => notify.success(_('admin.createUserSuccess', { name: res.data.username })),
              onError: (err) => notify.error(getUserErrorNotification(err, 'admin.createUserFailed')),
            })
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={_('admin.deleteUser')}
          message={_('admin.deleteUserConfirm', { name: deleteTarget.username })}
          confirmLabel={_('admin.delete')}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget
            setDeleteTarget(null)
            deleteUser.mutate(target.id, {
              onSuccess: () => notify.success(_('admin.deleteUserSuccess', { name: target.username })),
              onError: (err) => notify.error(getUserErrorNotification(err, 'admin.deleteUserFailed')),
            })
          }}
        />
      )}
    </>
  )
}

function UserRow({ user, isSelf, onAction, onTransfer, onResetPassword, onDelete }: {
  user: AdminUserRes
  isSelf: boolean
  onAction: (action: PendingAction) => void
  onTransfer: (user: AdminUserRes) => void
  onResetPassword: (user: AdminUserRes) => void
  onDelete: (user: AdminUserRes) => void
}) {
  const _ = useTranslation()
  const menu = useContextMenu()
  // Deletion blockers are pre-checked so the menu never offers an action the
  // server would refuse: self-service deletion lives on the profile page, the
  // instance owner must transfer first, and shared-library owners must
  // transfer or delete those libraries first.
  const deleteBlocked = isSelf
    ? _('admin.cannotDeleteSelf')
    : user.role === 'owner'
      ? _('admin.cannotDeleteOwner')
      : user.ownedLibraries.length > 0
        ? _('admin.cannotDeleteLibraryOwner', { names: user.ownedLibraries.map((l) => l.name).join('、') })
        : null

  return (
    <tr className="transition-colors hover:bg-stone-50/50 dark:hover:bg-stone-800/30">
      <td className="py-3 pl-4 pr-3 sm:pl-6">
        <span className="flex items-center gap-2.5 min-w-0">
          <MemberAvatar username={user.username} avatarKey={user.avatarKey} isOwner={user.role === 'owner'} />
          <span className="font-medium text-stone-800 dark:text-stone-100 truncate">{user.username}</span>
          {isSelf && <span className="ml-1 rounded bg-stone-100 px-1 py-0.5 text-[11px] text-stone-400 shrink-0 dark:bg-stone-800">{_('admin.self')}</span>}
        </span>
      </td>
      <td className="py-3 px-3">
        <RoleBadge role={user.role} />
      </td>
      <td className="py-3 px-3 tabular-nums text-stone-500 dark:text-stone-400">{user.bookCount}</td>
      <td className="py-3 px-3">
        <span
          className={cn(
            'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium',
            user.disabled
              ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
          )}
        >
          {user.disabled ? _('admin.statusDisabled') : _('admin.statusActive')}
        </span>
      </td>
      <td className="py-3 px-3 whitespace-nowrap text-xs text-stone-400">{formatDate(user.createdAt)}</td>
      <td className="py-3 pl-3 pr-4 text-right sm:pr-6">
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
        <SmartMenu triggerRef={menu.btnRef} innerRef={menu.menuRef} position={menu.position(176, isSelf ? 64 : 148)} onClose={menu.close}>
          {!isSelf && user.role === 'member' && !user.disabled && (
            <button
              type="button"
              onClick={() => {
                menu.close()
                onTransfer(user)
              }}
              className={menuItemClass}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-500">
                <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.203a4 4 0 0 1-3.86 2.928H8.713a4 4 0 0 1-3.86-2.928L2.018 6.02a.5.5 0 0 1 .798-.52l4.278 3.665a1 1 0 0 0 1.516-.294z" />
              </svg>
              <span>{_('admin.transferOwner')}</span>
            </button>
          )}
          {!isSelf && (
            <button
              type="button"
              onClick={() => {
                menu.close()
                onAction({
                  user,
                  req: { disabled: !user.disabled },
                  title: user.disabled ? _('admin.enable') : _('admin.disable'),
                  message: user.disabled
                    ? _('admin.enableConfirm', { name: user.username })
                    : _('admin.disableConfirm', { name: user.username }),
                })
              }}
              className={menuItemClass}
            >
              {user.disabled ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-500">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <path d="m9 11 3 3L22 4" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
              )}
              <span>{user.disabled ? _('admin.enable') : _('admin.disable')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              menu.close()
              onResetPassword(user)
            }}
            className={menuItemClass}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
              <path d="m21 2-9.6 9.6" />
              <circle cx="7.5" cy="15.5" r="5.5" />
              <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
            </svg>
            <span>{_('admin.resetPassword')}</span>
          </button>
          {deleteBlocked === null ? (
            <button
              type="button"
              onClick={() => {
                menu.close()
                onDelete(user)
              }}
              className={cn(menuItemClass, 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-red-500">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
              <span>{_('admin.delete')}</span>
            </button>
          ) : !isSelf && (
            <span title={deleteBlocked} className={cn(menuItemClass, 'cursor-not-allowed opacity-50')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
              <span>{_('admin.delete')}</span>
            </span>
          )}
        </SmartMenu>
      </td>
    </tr>
  )
}

function ResetPasswordDialog({ user, onClose, onSubmit }: {
  user: AdminUserRes | null
  onClose: () => void
  onSubmit: (password: string) => void
}) {
  const _ = useTranslation()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
            setError(_('auth.passwordTooShort', { min: AUTH_PASSWORD_MIN_LENGTH }))
            return
          }
          onSubmit(password)
        }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto rounded-t-2xl border border-stone-200 bg-white p-5 shadow-xl sm:max-h-none sm:rounded-2xl sm:p-6 dark:border-stone-800 dark:bg-stone-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            {_('admin.resetPassword')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
            aria-label={_('library.cancel')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="mb-3 text-xs text-stone-500 dark:text-stone-400">{_('admin.resetPasswordFor', { name: user.username })}</p>
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300" htmlFor="reset-user-password">
            {_('auth.newPassword')}
          </label>
          <div className="relative">
            <input
              id="reset-user-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-label={_('auth.newPassword')}
              placeholder={_('auth.newPassword')}
              className="h-10 w-full rounded-xl border border-stone-200 bg-white pl-3 pr-10 text-sm text-stone-800 outline-none transition-colors focus:border-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
            >
              <EyeToggleIcon show={showPassword} />
            </button>
          </div>
        </div>
        {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {_('library.cancel')}
          </Button>
          <Button type="submit">
            {_('library.save')}
          </Button>
        </div>
      </form>
    </div>
  )
}

function CreateUserDialog({ onClose, onSubmit }: {
  onClose: () => void
  onSubmit: (username: string, password: string) => void
}) {
  const _ = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const name = sanitizeUsername(username)
    if (!name) {
      setError(_('auth.errors.usernameRequired'))
      return
    }
    if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
      setError(_('auth.passwordTooShort', { min: AUTH_PASSWORD_MIN_LENGTH }))
      return
    }
    if (password !== confirm) {
      setError(_('auth.passwordMismatch'))
      return
    }
    onSubmit(name, password)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto rounded-t-2xl border border-stone-200 bg-white p-5 shadow-xl sm:max-h-none sm:rounded-2xl sm:p-6 dark:border-stone-800 dark:bg-stone-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            {_('admin.createUser')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
            aria-label={_('library.cancel')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 mb-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-600 dark:text-stone-300" htmlFor="new-user-username">
              {_('auth.username')}
            </label>
            <input
              id="new-user-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              maxLength={AUTH_REGISTER_USERNAME_MAX_LENGTH}
              aria-label={_('auth.username')}
              placeholder={_('auth.username')}
              autoComplete="off"
              className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none transition-colors focus:border-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-stone-600 dark:text-stone-300" htmlFor="new-user-password">
              {_('auth.newPassword')}
            </label>
            <div className="relative">
              <input
                id="new-user-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                aria-label={_('auth.newPassword')}
                placeholder={_('auth.newPassword')}
                autoComplete="new-password"
                className="h-10 w-full rounded-xl border border-stone-200 bg-white pl-3 pr-10 text-sm text-stone-800 outline-none transition-colors focus:border-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
                aria-label={showPassword ? _('admin.hidePassword') : _('admin.showPassword')}
              >
                <EyeToggleIcon show={showPassword} />
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-stone-600 dark:text-stone-300" htmlFor="new-user-confirm">
              {_('auth.confirmPassword')}
            </label>
            <div className="relative">
              <input
                id="new-user-confirm"
                type={showConfirm ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                aria-label={_('auth.confirmPassword')}
                placeholder={_('auth.confirmPassword')}
                autoComplete="new-password"
                className="h-10 w-full rounded-xl border border-stone-200 bg-white pl-3 pr-10 text-sm text-stone-800 outline-none transition-colors focus:border-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
                aria-label={showConfirm ? _('admin.hidePassword') : _('admin.showPassword')}
              >
                <EyeToggleIcon show={showConfirm} />
              </button>
            </div>
          </div>
        </div>

        {error && <p className="mb-4 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {_('library.cancel')}
          </Button>
          <Button type="submit">
            {_('library.create')}
          </Button>
        </div>
      </form>
    </div>
  )
}

function LibraryMembersView({
  activeLibraryId,
  hasManageableLibraries,
}: {
  activeLibraryId?: string
  hasManageableLibraries: boolean
}) {
  const _ = useTranslation()
  const currentUser = useAuthStore((s) => s.user)
  const { data: librariesData, isLoading: librariesLoading } = useLibraries()
  const selectedLibrary = (librariesData?.data ?? []).find((l) => l.id === activeLibraryId)
  const isLibraryOwner = selectedLibrary?.relation === 'owner'

  const { data: membersData, isLoading: membersLoading, isError, isFetching, refetch } = useLibraryMembers(activeLibraryId ?? null)
  const setMemberRole = useSetLibraryMemberRole()
  const removeMember = useRemoveLibraryMember()
  const transferLibrary = useTransferLibrary()

  const [removeTarget, setRemoveTarget] = useState<LibraryMemberEntry | null>(null)
  const [transferTarget, setTransferTarget] = useState<LibraryMemberEntry | null>(null)

  const owner = membersData?.data?.owner
  const members = useMemo(() => {
    const list = [...(membersData?.data?.members ?? [])]
    const ROLE_WEIGHT: Record<string, number> = { admin: 0, member: 1 }
    return list.sort((a, b) => {
      const weightA = ROLE_WEIGHT[a.role] ?? 2
      const weightB = ROLE_WEIGHT[b.role] ?? 2
      if (weightA !== weightB) return weightA - weightB
      return a.createdAt - b.createdAt
    })
  }, [membersData?.data?.members])

  if (librariesLoading) {
    return (
      <div className="space-y-3 p-4 sm:p-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex animate-pulse items-center justify-between py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-full bg-stone-200/80 dark:bg-stone-800" />
              <div className="space-y-1.5">
                <div className="h-4 w-28 rounded bg-stone-200/80 dark:bg-stone-800" />
                <div className="h-3 w-40 rounded bg-stone-100 dark:bg-stone-800/60" />
              </div>
            </div>
            <div className="h-6 w-16 rounded-md bg-stone-200/80 dark:bg-stone-800" />
          </div>
        ))}
      </div>
    )
  }

  if (!hasManageableLibraries) {
    return (
      <div className="p-8 text-center text-xs text-stone-400 dark:text-stone-500">
        {_('admin.noManageableLibraries')}
      </div>
    )
  }

  return (
    <>
      {membersLoading ? (
        <div className="space-y-3 p-4 sm:p-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex animate-pulse items-center justify-between py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-full bg-stone-200/80 dark:bg-stone-800" />
                <div className="space-y-1.5">
                  <div className="h-4 w-28 rounded bg-stone-200/80 dark:bg-stone-800" />
                  <div className="h-3 w-40 rounded bg-stone-100 dark:bg-stone-800/60" />
                </div>
              </div>
              <div className="h-6 w-16 rounded-md bg-stone-200/80 dark:bg-stone-800" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="p-4 sm:p-6">
          <QueryErrorState isRetrying={isFetching} onRetry={refetch} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-sm sm:min-w-full">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50/50 text-xs text-stone-400 dark:border-stone-800 dark:bg-stone-800/40">
                <th className="w-[45%] py-2.5 pl-4 pr-3 font-medium sm:pl-6">{_('auth.username')}</th>
                <th className="w-[25%] py-2.5 px-3 font-medium">{_('library.memberRole')}</th>
                <th className="w-[25%] py-2.5 px-3 whitespace-nowrap font-medium">{_('library.memberJoinedAt')}</th>
                <th className="w-10 py-2.5 pl-3 pr-4 text-right sm:pr-6" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100/70 dark:divide-stone-800/50">
              {owner && (
                <tr className="transition-colors hover:bg-stone-50/50 dark:hover:bg-stone-800/30">
                  <td className="py-3 pl-4 pr-3 sm:pl-6">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <MemberAvatar username={owner.username} avatarKey={owner.avatarKey} isOwner />
                      <span className="font-medium text-stone-800 dark:text-stone-100 truncate">{owner.username}</span>
                      {currentUser?.id === owner.id && (
                        <span className="ml-1 rounded bg-stone-100 px-1 py-0.5 text-[11px] text-stone-400 shrink-0 dark:bg-stone-800">{_('admin.self')}</span>
                      )}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <RoleBadge role="owner" />
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-xs text-stone-400">
                    {owner.createdAt || selectedLibrary?.createdAt
                      ? formatDate(owner.createdAt ?? selectedLibrary!.createdAt)
                      : '—'}
                  </td>
                  <td className="py-3 pl-3 pr-4 text-right sm:pr-6" />
                </tr>
              )}
              {members.map((member) => (
                <LibraryMemberRow
                  key={member.id}
                  member={member}
                  isSelf={member.userId === currentUser?.id}
                  isOwner={isLibraryOwner}
                  onSetRole={(role) => {
                    if (!activeLibraryId) return
                    setMemberRole.mutate({
                      libraryId: activeLibraryId,
                      userId: member.userId,
                      role,
                    }, {
                      onError: (err) => notify.error(getUserErrorNotification(err, 'library.memberRoleChangeFailed')),
                    })
                  }}
                  onTransfer={() => setTransferTarget(member)}
                  onRemove={() => setRemoveTarget(member)}
                />
              ))}
              {!owner && members.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-xs text-stone-400 dark:text-stone-500">
                    {_('library.noMembersYet')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {removeTarget && activeLibraryId && (
        <ConfirmDialog
          title={_('library.removeMember')}
          message={_('library.removeMemberConfirm', { name: removeTarget.username })}
          confirmLabel={_('library.remove')}
          confirmVariant="danger"
          onClose={() => setRemoveTarget(null)}
          onConfirm={() => {
            const target = removeTarget
            setRemoveTarget(null)
            removeMember.mutate({
              libraryId: activeLibraryId,
              userId: target.userId,
            }, {
              onSuccess: () => notify.success(_('library.memberRemoved')),
              onError: (err) => notify.error(getUserErrorNotification(err, 'library.removeMemberFailed')),
            })
          }}
        />
      )}

      {transferTarget && activeLibraryId && (
        <ConfirmDialog
          title={_('library.transferOwner')}
          message={_('library.transferOwnerConfirm', { name: transferTarget.username })}
          confirmLabel={_('library.transferOwner')}
          onClose={() => setTransferTarget(null)}
          onConfirm={() => {
            const target = transferTarget
            setTransferTarget(null)
            transferLibrary.mutate({
              libraryId: activeLibraryId,
              userId: target.userId,
            }, {
              onSuccess: () => notify.success(_('library.transferOwnerSuccess')),
              onError: (err) => notify.error(getUserErrorNotification(err, 'library.transferOwnerFailed')),
            })
          }}
        />
      )}
    </>
  )
}

function LibraryMemberRow({
  member,
  isSelf,
  isOwner,
  onSetRole,
  onTransfer,
  onRemove,
}: {
  member: LibraryMemberEntry
  isSelf?: boolean
  isOwner: boolean
  onSetRole: (role: MembershipRole) => void
  onTransfer: () => void
  onRemove: () => void
}) {
  const _ = useTranslation()
  const menu = useContextMenu()

  const canChangeRole = isOwner && !isSelf
  const canTransfer = isOwner && !isSelf
  const canRemove = (isOwner || member.role !== 'admin') && !isSelf
  const hasActions = canChangeRole || canTransfer || canRemove

  return (
    <tr className="transition-colors hover:bg-stone-50/50 dark:hover:bg-stone-800/30">
      <td className="py-3 pl-4 pr-3 sm:pl-6">
        <span className="flex items-center gap-2.5 min-w-0">
          <MemberAvatar username={member.username} avatarKey={member.avatarKey} />
          <span className="font-medium text-stone-800 dark:text-stone-100 truncate">{member.username}</span>
          {isSelf && (
            <span className="ml-1 rounded bg-stone-100 px-1 py-0.5 text-[11px] text-stone-400 shrink-0 dark:bg-stone-800">{_('admin.self')}</span>
          )}
        </span>
      </td>
      <td className="py-3 px-3">
        <RoleBadge role={member.role} />
      </td>
      <td className="py-3 px-3 whitespace-nowrap text-xs text-stone-400">
        {formatDate(member.createdAt)}
      </td>
      <td className="py-3 pl-3 pr-4 text-right sm:pr-6">
        {hasActions && (
          <>
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
            <SmartMenu triggerRef={menu.btnRef} innerRef={menu.menuRef} position={menu.position(160, 120)} onClose={menu.close}>
              {canChangeRole && (
                <button
                  type="button"
                  onClick={() => {
                    menu.close()
                    onSetRole(member.role === 'admin' ? 'member' : 'admin')
                  }}
                  className={menuItemClass}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <span>{member.role === 'admin' ? _('library.setAsMember') : _('library.setAsAdmin')}</span>
                </button>
              )}
              {canTransfer && (
                <button
                  type="button"
                  onClick={() => {
                    menu.close()
                    onTransfer()
                  }}
                  className={menuItemClass}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-500">
                    <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.203a4 4 0 0 1-3.86 2.928H8.713a4 4 0 0 1-3.86-2.928L2.018 6.02a.5.5 0 0 1 .798-.52l4.278 3.665a1 1 0 0 0 1.516-.294z" />
                  </svg>
                  <span>{_('library.transferOwner')}</span>
                </button>
              )}
              {canRemove && (
                <button
                  type="button"
                  onClick={() => {
                    menu.close()
                    onRemove()
                  }}
                  className={cn(menuItemClass, 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-red-500">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>{_('library.remove')}</span>
                </button>
              )}
            </SmartMenu>
          </>
        )}
      </td>
    </tr>
  )
}
