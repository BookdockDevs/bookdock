import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  AUTH_REGISTER_USERNAME_MAX_LENGTH,
  INSTANCE_INVITE_CODE_MAX_LENGTH,
  isValidInstanceInviteCode,
  normalizeInstanceInviteCode,
} from '@bookdock/shared'

import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/Button'
import PasswordInput from '@/components/ui/PasswordInput'
import { validatePasswordInputs } from '@/components/ui/password-input-validation'
import { libraryInviteParam, PENDING_INVITE_KEY } from '@/features/library/invite-link'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'

import AuthCardShell, {
  authAlertClassName,
  authFieldErrorClassName,
  authInputClassName,
  authLabelClassName,
} from './AuthCardShell'
import { authErrorKey } from './errors'
import { useInstanceInfo, useRegister } from './hooks'

export default function Register() {
  const _ = useTranslation()
  usePageTitle(_('auth.registerTitle'))
  const navigate = useNavigate()
  const register = useRegister()
  const { data: instanceData } = useInstanceInfo()
  const registrationMode = instanceData?.data.registrationMode ?? (instanceData?.data.allowRegistration ? 'open' : 'closed')

  const [initialInvite] = useState(() => new URLSearchParams(window.location.search).get('invite')?.trim() ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [inviteCode, setInviteCode] = useState(initialInvite)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ field: 'username' | 'inviteCode'; message: string } | null>(null)

  const normalizedInvite = normalizeInstanceInviteCode(inviteCode)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (register.isPending) return
    setFormError(null)
    setFieldError(null)

    const normalizedUsername = username.trim()
    if (!normalizedUsername) {
      setFieldError({ field: 'username', message: _('auth.errors.usernameRequired') })
      return
    }
    if (normalizedUsername.length > AUTH_REGISTER_USERNAME_MAX_LENGTH) {
      setFieldError({ field: 'username', message: _('auth.errors.registerUsernameTooLong') })
      return
    }
    if (!validatePasswordInputs(e)) return

    if (registrationMode === 'invite' && !normalizedInvite) {
      setFieldError({ field: 'inviteCode', message: _('auth.errors.inviteCodeRequired') })
      return
    }
    if (normalizedInvite && !isValidInstanceInviteCode(normalizedInvite)) {
      setFormError(_('auth.errors.inviteCodeInvalid'))
      return
    }

    try {
      const res = await register.mutateAsync({
        username: normalizedUsername,
        password,
        ...(normalizedInvite ? { inviteCode: normalizedInvite } : {}),
      })
      const pending = sessionStorage.getItem(PENDING_INVITE_KEY)
      if (pending) {
        navigate({ to: '/library/$token', params: { token: libraryInviteParam(pending) } })
        return
      }
      if (res.data.joinedLibraries && res.data.joinedLibraries.length > 0) {
        navigate({ to: '/', search: { libraryId: res.data.joinedLibraries[0]!.id } })
        return
      }
      navigate({ to: '/' })
    } catch (err) {
      const message = _(authErrorKey(err))
      if (err instanceof ApiError && err.code === 'INVITE_CODE_REQUIRED') {
        setFieldError({ field: 'inviteCode', message })
      } else if (err instanceof ApiError && err.code === 'USERNAME_TAKEN') {
        setFieldError({ field: 'username', message })
      } else {
        setFormError(message)
      }
    }
  }

  const usernameError = fieldError?.field === 'username' ? fieldError.message : null
  const inviteError = fieldError?.field === 'inviteCode' ? fieldError.message : null

  return (
    <AuthCardShell
      title={_('auth.title')}
      subtitle={_('auth.registerSubtitleOpen')}
      footer={(
        <p className="text-sm text-stone-500 dark:text-stone-400">
          <span>{_('auth.alreadyHaveAccount')} </span>
          <Link
            to="/login"
            className="font-medium text-stone-900 underline underline-offset-4 hover:text-stone-700 dark:text-stone-100 dark:hover:text-stone-300"
          >
            {_('auth.backToSignIn')}
          </Link>
        </p>
      )}
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-4">
          <label htmlFor="username" className={authLabelClassName}>{_('auth.username')}</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              setFormError(null)
              if (fieldError?.field === 'username') setFieldError(null)
            }}
            required
            maxLength={AUTH_REGISTER_USERNAME_MAX_LENGTH}
            autoComplete="username"
            aria-invalid={Boolean(usernameError)}
            aria-describedby={usernameError ? 'register-username-error' : formError ? 'register-error' : undefined}
            className={authInputClassName}
          />
          {usernameError && (
            <p id="register-username-error" role="alert" className={authFieldErrorClassName}>
              {usernameError}
            </p>
          )}
        </div>
        <div className="mb-4">
          <label htmlFor="password" className={authLabelClassName}>{_('auth.password')}</label>
          <PasswordInput
            disabled={register.isPending}
            id="password"
            minLength={AUTH_PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setFormError(null)
            }}
            required
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            className={authInputClassName}
          />
        </div>
        <div className="mb-4">
          <label htmlFor="confirmPassword" className={authLabelClassName}>{_('auth.confirmPassword')}</label>
          <PasswordInput
            disabled={register.isPending}
            id="confirmPassword"
            matches={password}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              setFormError(null)
            }}
            required
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            className={authInputClassName}
          />
        </div>
        <div className="mb-6">
          <label htmlFor="inviteCode" className={authLabelClassName}>
            {_('auth.inviteCode')}
          </label>
          <input
            id="inviteCode"
            type="text"
            value={inviteCode}
            onChange={(e) => {
              setInviteCode(e.target.value)
              setFormError(null)
              if (fieldError?.field === 'inviteCode') setFieldError(null)
            }}
            required={registrationMode === 'invite'}
            maxLength={INSTANCE_INVITE_CODE_MAX_LENGTH}
            placeholder={registrationMode === 'invite' ? undefined : _('auth.inviteCodePlaceholderOptional')}
            aria-invalid={Boolean(inviteError)}
            aria-describedby={inviteError ? 'register-invite-error' : formError ? 'register-error' : undefined}
            className={authInputClassName}
          />
          {inviteError && (
            <p id="register-invite-error" role="alert" className={authFieldErrorClassName}>
              {inviteError}
            </p>
          )}
        </div>
        {formError && (
          <p id="register-error" role="alert" aria-live="polite" className={authAlertClassName}>
            {formError}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {_(register.isPending ? 'passwordInput.creating' : 'auth.register')}
        </Button>
      </form>
    </AuthCardShell>
  )
}
