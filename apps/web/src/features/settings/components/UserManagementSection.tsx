import { useState } from 'react'

import { AUTH_PASSWORD_MIN_LENGTH } from '@bookdock/shared'
import type { AdminUserRes, UpdateUserReq } from '@bookdock/shared'

import { cn } from '@/lib/utils'
import SmartMenu from '@/components/ui/SmartMenu'
import { useAdminUsers, useUpdateUser } from '@/features/auth/hooks'
import { useContextMenu } from '@/features/library/components/use-context-menu'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
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

interface PendingAction {
  user: AdminUserRes
  req: UpdateUserReq
  title: string
  message: string
}

export default function UserManagementSection() {
  const _ = useTranslation()
  const currentUser = useAuthStore((s) => s.user)
  const { data: usersData, isError, isFetching, isLoading, refetch } = useAdminUsers()
  const updateUser = useUpdateUser()
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [resetTarget, setResetTarget] = useState<AdminUserRes | null>(null)

  const users = usersData?.data ?? []

  function runUpdate(id: string, req: UpdateUserReq) {
    updateUser.mutate(
      { id, ...req },
      { onError: (err) => notify.error(getUserErrorNotification(err, 'auth.errors.userUpdateFailed')) },
    )
  }

  return (
    <>
      <SettingsCard
        icon={<UsersIcon className="h-5 w-5" />}
        iconBgClass="bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
        title={_('admin.userManagement')}
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
        ) : (
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
                    onResetPassword={setResetTarget}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsCard>

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

      <ResetPasswordDialog
        user={resetTarget}
        onClose={() => setResetTarget(null)}
        onSubmit={(password) => {
          const target = resetTarget
          setResetTarget(null)
          if (target) runUpdate(target.id, { newPassword: password })
        }}
      />
    </>
  )
}

function UserRow({ user, isSelf, onAction, onResetPassword }: {
  user: AdminUserRes
  isSelf: boolean
  onAction: (action: PendingAction) => void
  onResetPassword: (user: AdminUserRes) => void
}) {
  const _ = useTranslation()
  const menu = useContextMenu()

  const roleLabel = user.role === 'owner' ? _('auth.roleOwner') : user.role === 'guest' ? _('auth.guest') : _('auth.roleMember')

  return (
    <tr className="transition-colors hover:bg-stone-50/50 dark:hover:bg-stone-800/30">
      <td className="py-3 pl-4 pr-3 sm:pl-6">
        <span className="font-medium text-stone-800 dark:text-stone-100">{user.username}</span>
        {isSelf && <span className="ml-1.5 rounded bg-stone-100 px-1 py-0.5 text-[11px] text-stone-400 dark:bg-stone-800">{_('admin.self')}</span>}
      </td>
      <td className="py-3 px-3 text-stone-500 dark:text-stone-400">{roleLabel}</td>
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
          {!isSelf && user.role !== 'guest' && (
            <button
              type="button"
              onClick={() => {
                menu.close()
                const toOwner = user.role !== 'owner'
                onAction({
                  user,
                  req: { role: toOwner ? 'owner' : 'member' },
                  title: toOwner ? _('admin.makeOwner') : _('admin.makeMember'),
                  message: toOwner
                    ? _('admin.makeOwnerConfirm', { name: user.username })
                    : _('admin.makeMemberConfirm', { name: user.username }),
                })
              }}
              className={menuItemClass}
            >
              {user.role === 'owner' ? _('admin.makeMember') : _('admin.makeOwner')}
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

const menuItemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'
