import { useState } from 'react'

import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from '@bookdock/shared'

import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/Button'
import PasswordInput from '@/components/ui/PasswordInput'
import { validatePasswordInputs } from '@/components/ui/password-input-validation'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { authErrorKey } from './errors'
import { useChangePassword } from './hooks'

interface ChangePasswordDialogProps {
  open: boolean
  onClose: () => void
}

export default function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps) {
  return open ? <ChangePasswordForm onClose={onClose} /> : null
}

function ChangePasswordForm({ onClose }: Pick<ChangePasswordDialogProps, 'onClose'>) {
  const _ = useTranslation()
  const changePassword = useChangePassword()
  const [oldPassword, setOldPassword] = useState('')
  const [oldPasswordError, setOldPasswordError] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (changePassword.isPending) return
    setError(null)
    if (!validatePasswordInputs(e)) return

    try {
      await changePassword.mutateAsync({ oldPassword, newPassword })
      notify.success({ key: 'auth.passwordChanged' })
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        setOldPasswordError(_('auth.errors.wrongOldPassword'))
        document.getElementById('oldPassword')?.focus()
      } else {
        setError(_(authErrorKey(err)))
      }
    }
  }

  return (
    <Modal title={_('auth.changePassword')} onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-3">
          <label htmlFor="oldPassword" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">
            {_('auth.oldPassword')}
          </label>
          <PasswordInput
            disabled={changePassword.isPending}
            id="oldPassword"
            error={oldPasswordError}
            value={oldPassword}
            onChange={(e) => {
              setOldPassword(e.target.value)
              setOldPasswordError(null)
              setError(null)
            }}
            required
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            autoComplete="current-password"
            autoFocus
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        <div className="mb-3">
          <label htmlFor="newPassword" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">
            {_('auth.newPassword')}
          </label>
          <PasswordInput
            disabled={changePassword.isPending}
            id="newPassword"
            minLength={AUTH_PASSWORD_MIN_LENGTH}
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value)
              setError(null)
            }}
            required
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        <div className="mb-4">
          <label htmlFor="confirmNewPassword" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">
            {_('auth.confirmPassword')}
          </label>
          <PasswordInput
            disabled={changePassword.isPending}
            id="confirmNewPassword"
            matches={newPassword}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              setError(null)
            }}
            required
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        {error && (
          <p role="alert" aria-live="polite" className="mb-4 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {_('library.cancel')}
          </Button>
          <Button type="submit" disabled={changePassword.isPending}>
            {_(changePassword.isPending ? 'passwordInput.saving' : 'library.save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
