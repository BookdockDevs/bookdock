import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { AUTH_PASSWORD_MAX_LENGTH, AUTH_USERNAME_MAX_LENGTH } from '@bookdock/shared'

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
import { useInstanceInfo, useLogin } from './hooks'
import { clearReaderTarget, pendingReaderTarget } from './reader-return'

export default function Login() {
  const _ = useTranslation()
  usePageTitle(_('auth.signIn'))
  const navigate = useNavigate()
  const isLegadoLogin = new URLSearchParams(window.location.search).get('legado') === '1'
  const login = useLogin()
  const { data: instanceData } = useInstanceInfo()
  const registrationMode = instanceData?.data.registrationMode ?? (instanceData?.data.allowRegistration ? 'open' : 'closed')
  const allowGuestAccess = Boolean(instanceData?.data.allowGuestAccess) && !isLegadoLogin
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [usernameError, setUsernameError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (login.isPending) return
    setError(null)
    setUsernameError(null)
    const normalizedUsername = username.trim()
    if (!normalizedUsername) {
      setUsernameError(_('auth.errors.usernameRequired'))
      return
    }
    if (normalizedUsername.length > AUTH_USERNAME_MAX_LENGTH) {
      setUsernameError(_('auth.errors.usernameTooLong'))
      return
    }
    if (!validatePasswordInputs(e)) return

    try {
      await login.mutateAsync({ username: normalizedUsername, password })
      if (isLegadoLogin) {
        clearReaderTarget()
        window.location.assign('/')
      } else {
        const pending = sessionStorage.getItem(PENDING_INVITE_KEY)
        if (pending) clearReaderTarget()
        const readerTarget = pending ? null : pendingReaderTarget()
        if (readerTarget) { window.location.assign(readerTarget); return }
        navigate(pending
          ? { to: '/library/$token', params: { token: libraryInviteParam(pending) } }
          : { to: '/' })
      }
    } catch (err) {
      setError(_(authErrorKey(err)))
    }
  }

  const hasFooter = registrationMode !== 'closed' || allowGuestAccess

  return (
    <AuthCardShell
      title={_('auth.title')}
      subtitle={_('auth.signInSubtitle')}
      footer={hasFooter ? (
        <div className="space-y-3">
          {registrationMode !== 'closed' && (
            <p className="text-sm text-stone-500 dark:text-stone-400">
              <span>{_('auth.noAccountYet')} </span>
              <Link
                to="/register"
                className="font-medium text-stone-900 underline underline-offset-4 hover:text-stone-700 dark:text-stone-100 dark:hover:text-stone-300"
              >
                {_(registrationMode === 'invite' ? 'auth.registerWithInvite' : 'auth.registerAccount')}
              </Link>
            </p>
          )}
          {allowGuestAccess && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => navigate({ to: '/' })}
            >
              {_('auth.continueAsGuest')}
            </Button>
          )}
        </div>
      ) : undefined}
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
              setError(null)
              setUsernameError(null)
            }}
            required
            maxLength={AUTH_USERNAME_MAX_LENGTH}
            autoComplete="username"
            aria-invalid={Boolean(usernameError)}
            aria-describedby={usernameError ? 'login-username-error' : error ? 'login-error' : undefined}
            className={authInputClassName}
          />
          {usernameError && (
            <p id="login-username-error" role="alert" className={authFieldErrorClassName}>
              {usernameError}
            </p>
          )}
        </div>
        <div className="mb-6">
          <label htmlFor="password" className={authLabelClassName}>{_('auth.password')}</label>
          <PasswordInput
            disabled={login.isPending}
            id="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            required
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            autoComplete="current-password"
            aria-describedby={error ? 'login-error' : undefined}
            className={authInputClassName}
          />
        </div>
        {error && (
          <p id="login-error" role="alert" aria-live="polite" className={authAlertClassName}>
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {_(login.isPending ? 'passwordInput.signingIn' : 'auth.signIn')}
        </Button>
      </form>
    </AuthCardShell>
  )
}
