import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { apiPost, ApiError } from '@/api/client'
import { Button } from '@/components/ui/Button'
import PasswordInput from '@/components/ui/PasswordInput'
import { validatePasswordInputs } from '@/components/ui/password-input-validation'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH, AUTH_USERNAME_MAX_LENGTH, type SetupRes } from '@bookdock/shared'

import AuthCardShell, {
  authAlertClassName,
  authFieldErrorClassName,
  authInputClassName,
  authLabelClassName,
} from './AuthCardShell'
import { authErrorKey } from './errors'
import { INSTANCE_QUERY_KEY, ME_QUERY_KEY } from './hooks'

export default function Setup() {
  const _ = useTranslation()
  usePageTitle(_('auth.setupTitle'))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Provisioning the first owner is not idempotent: a second concurrent
    // request races the first and comes back FORBIDDEN. Lock the submit for
    // the whole request so a double click cannot start two.
    if (pending) return
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

    setPending(true)
    try {
      const res = await apiPost<{ data: SetupRes }>('/auth/setup', { username: normalizedUsername, password })
      setAuth(res.data.user)
      await queryClient.invalidateQueries({ queryKey: INSTANCE_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
      navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'FORBIDDEN' ? _('auth.setupFailed') : _(authErrorKey(err)))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthCardShell
      title={_('auth.welcome')}
      subtitle={_('auth.setupSubtitle')}
      badge={_('auth.setupTitle')}
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-4">
          <label htmlFor="username" className={authLabelClassName}>
            {_('auth.username')}
          </label>
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
            aria-describedby={usernameError ? 'setup-username-error' : undefined}
            className={authInputClassName}
          />
          {usernameError && (
            <p id="setup-username-error" role="alert" className={authFieldErrorClassName}>
              {usernameError}
            </p>
          )}
        </div>
        <div className="mb-4">
          <label htmlFor="password" className={authLabelClassName}>
            {_('auth.password')}
          </label>
          <PasswordInput
            disabled={pending}
            id="password"
            minLength={AUTH_PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            required
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            className={authInputClassName}
          />
        </div>
        <div className="mb-6">
          <label htmlFor="confirmPassword" className={authLabelClassName}>
            {_('auth.confirmPassword')}
          </label>
          <PasswordInput
            disabled={pending}
            id="confirmPassword"
            matches={password}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              setError(null)
            }}
            required
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            className={authInputClassName}
          />
        </div>
        {error && (
          <p role="alert" aria-live="polite" className={authAlertClassName}>
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {_(pending ? 'passwordInput.creating' : 'auth.completeSetup')}
        </Button>
      </form>
    </AuthCardShell>
  )
}
