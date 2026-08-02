import { useState } from 'react'

import type { AdminUserRes, UpdateUserReq } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useAdminUsers, useUpdateUser } from '@/features/auth/hooks'
import { authErrorKey } from '@/features/auth/errors'
import { useContextMenu } from '@/features/library/components/use-context-menu'
import DeleteConfirm from '@/features/library/components/DeleteConfirm'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'

interface PendingAction {
  user: AdminUserRes
  req: UpdateUserReq
  title: string
  message: string
}

export default function UserManagementSection() {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const currentUser = useAuthStore((s) => s.user)
  const { data: usersData, isLoading } = useAdminUsers()
  const updateUser = useUpdateUser()
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [resetTarget, setResetTarget] = useState<AdminUserRes | null>(null)

  const users = usersData?.data ?? []

  function runUpdate(id: string, req: UpdateUserReq) {
    updateUser.mutate(
      { id, ...req },
      { onError: (err) => addToast(_(authErrorKey(err)), 'error') },
    )
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-4 text-sm font-medium">{_('admin.userManagement')}</h2>
      {isLoading ? (
        <p className="text-xs text-stone-400">{_('reader.loading')}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-xs text-stone-400 dark:border-stone-800">
              <th className="pb-2 font-medium">{_('auth.username')}</th>
              <th className="pb-2 font-medium">{_('admin.role')}</th>
              <th className="pb-2 font-medium">{_('admin.bookCount')}</th>
              <th className="pb-2 font-medium">{_('admin.status')}</th>
              <th className="pb-2 font-medium">{_('admin.createdAt')}</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
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
      )}

      <DeleteConfirm
        open={pendingAction !== null}
        title={pendingAction?.title}
        message={pendingAction?.message}
        confirmLabel={_('admin.confirm')}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction
          setPendingAction(null)
          if (action) runUpdate(action.user.id, action.req)
        }}
      />

      <ResetPasswordDialog
        user={resetTarget}
        onClose={() => setResetTarget(null)}
        onSubmit={(password) => {
          const target = resetTarget
          setResetTarget(null)
          if (target) runUpdate(target.id, { newPassword: password })
        }}
      />
    </section>
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
    <tr className="border-b border-stone-50 last:border-0 dark:border-stone-800/50">
      <td className="py-2.5 pr-2">
        <span className="text-stone-800 dark:text-stone-100">{user.username}</span>
        {isSelf && <span className="ml-1.5 text-xs text-stone-400">{_('admin.self')}</span>}
      </td>
      <td className="py-2.5 pr-2 text-stone-500">{roleLabel}</td>
      <td className="py-2.5 pr-2 tabular-nums text-stone-500">{user.bookCount}</td>
      <td className="py-2.5 pr-2">
        <span className={user.disabled ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}>
          {user.disabled ? _('admin.statusDisabled') : _('admin.statusActive')}
        </span>
      </td>
      <td className="py-2.5 pr-2 text-xs text-stone-400">{new Date(user.createdAt).toLocaleDateString()}</td>
      <td className="py-2.5 text-right">
        <button
          ref={menu.btnRef}
          type="button"
          aria-label={_('library.moreActions')}
          onClick={() => menu.openFromButton()}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>
        <SmartMenu innerRef={menu.menuRef} position={menu.position(176, isSelf ? 64 : 148)} onClose={menu.close}>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (password.length < 6) {
            setError(_('auth.passwordTooShort'))
            return
          }
          onSubmit(password)
        }}
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-800 dark:bg-stone-950"
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
