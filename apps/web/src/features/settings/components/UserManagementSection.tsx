import { useEffect, useState } from 'react'

import { AUTH_PASSWORD_MIN_LENGTH, AUTH_REGISTER_USERNAME_MAX_LENGTH, sanitizeUsername } from '@bookdock/shared'
import type { AdminUserRes, LibraryMemberEntry, MembershipRole, UpdateUserReq } from '@bookdock/shared'

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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {tab === 'library' && sharedLibraries.length > 0 && (
            <select
              aria-label={_('admin.selectLibrary')}
              value={activeLibraryId}
              onChange={(e) => setSelectedLibraryId(e.target.value)}
              className="h-7 rounded-lg border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-800 outline-none transition-all focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-200"
            >
              {sharedLibraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.name}
                </option>
              ))}
            </select>
          )}
          {!lockTab && (
            <div className="flex items-center rounded-xl bg-stone-100 p-0.5 dark:bg-stone-800">
              <button
                type="button"
                onClick={() => setTab('instance')}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-all',
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
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-all',
                  tab === 'library'
                    ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-900 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200',
                )}
              >
                {_('admin.userTabLibrary')}
              </button>
            </div>
          )}
        </div>
      }
      bodyClassName="-mx-4 -mb-4 sm:-mx-6 sm:-mb-6 mt-4 overflow-hidden rounded-b-2xl"
    >
      {tab === 'instance' ? (
        <InstanceUsersView />
      ) : (
        <LibraryMembersView
          activeLibraryId={activeLibraryId}
          hasManageableLibraries={sharedLibraries.length > 0}
        />
      )}
    </SettingsCard>
  )
}

function InstanceUsersView() {
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
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRes | null>(null)

  const users = usersData?.data ?? []

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
      <div className="flex items-center justify-end px-4 pt-3 sm:px-6">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          {_('admin.createUser')}
        </Button>
      </div>
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
          confirmLabel={_('admin.deleteUser')}
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
      <td className="py-3 px-3 whitespace-nowrap text-xs text-stone-400">{new Date(user.createdAt).toLocaleDateString()}</td>
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
              {_('admin.transferOwner')}
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
              {user.disabled ? _('admin.enable') : _('admin.disable')}
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
            {_('admin.resetPassword')}
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
              {_('admin.deleteUser')}
            </button>
          ) : !isSelf && (
            <span title={deleteBlocked} className={cn(menuItemClass, 'cursor-not-allowed opacity-50')}>
              {_('admin.deleteUser')}
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
        className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] rounded-t-2xl border border-stone-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-none sm:overflow-visible sm:rounded-2xl sm:p-6 dark:border-stone-800 dark:bg-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 font-serif text-base font-medium text-stone-900 dark:text-stone-100">
          {_('admin.resetPassword')}
        </h2>
        <p className="mb-4 text-sm text-stone-500">{_('admin.resetPasswordFor', { name: user.username })}</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          aria-label={_('auth.newPassword')}
          placeholder={_('auth.newPassword')}
          className="mb-4 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
        />
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {_('library.cancel')}
          </Button>
          <Button type="submit">{_('library.save')}</Button>
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
        className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] rounded-t-2xl border border-stone-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-none sm:overflow-visible sm:rounded-2xl sm:p-6 dark:border-stone-800 dark:bg-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 font-serif text-base font-medium text-stone-900 dark:text-stone-100">
          {_('admin.createUser')}
        </h2>
        <p className="mb-4 text-sm text-stone-500">{_('admin.createUserFor')}</p>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          maxLength={AUTH_REGISTER_USERNAME_MAX_LENGTH}
          aria-label={_('auth.username')}
          placeholder={_('auth.username')}
          autoComplete="off"
          className="mb-3 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          aria-label={_('auth.newPassword')}
          placeholder={_('auth.newPassword')}
          autoComplete="new-password"
          className="mb-3 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          aria-label={_('auth.confirmPassword')}
          placeholder={_('auth.confirmPassword')}
          autoComplete="new-password"
          className="mb-4 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
        />
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {_('library.cancel')}
          </Button>
          <Button type="submit">{_('admin.createUser')}</Button>
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
  const members = membersData?.data?.members ?? []

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
                      ? new Date(owner.createdAt ?? selectedLibrary!.createdAt).toLocaleDateString()
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
          confirmLabel={_('library.removeMember')}
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
        {new Date(member.createdAt).toLocaleDateString()}
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
                  {member.role === 'admin' ? _('library.setAsMember') : _('library.setAsAdmin')}
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
                  {_('library.transferOwner')}
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
                  {_('library.removeMember')}
                </button>
              )}
            </SmartMenu>
          </>
        )}
      </td>
    </tr>
  )
}
