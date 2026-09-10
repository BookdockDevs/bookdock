import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { apiPost, ApiError } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH, AUTH_USERNAME_MAX_LENGTH, type SetupRes } from '@bookdock/shared'

import { authErrorKey } from './errors'
import { INSTANCE_QUERY_KEY } from './hooks'

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const normalizedUsername = username.trim()
    if (!normalizedUsername) {
      setError(_('auth.errors.usernameRequired'))
      return
    }
    if (normalizedUsername.length > AUTH_USERNAME_MAX_LENGTH) {
      setError(_('auth.errors.usernameTooLong'))
      return
    }
    if (!password) {
      setError(_('auth.errors.passwordRequired'))
      return
    }
    if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
      setError(_('auth.passwordTooShort'))
      return
    }
    if (password.length > AUTH_PASSWORD_MAX_LENGTH) {
      setError(_('auth.errors.passwordTooLong'))
      return
    }
    if (password !== confirmPassword) {
      setError(_('auth.passwordMismatch'))
      return
    }

    try {
      const res = await apiPost<{ data: SetupRes }>('/auth/setup', { username: normalizedUsername, password })
      setAuth(res.data.user)
      await queryClient.invalidateQueries({ queryKey: INSTANCE_QUERY_KEY })
      navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'FORBIDDEN' ? _('auth.setupFailed') : _(authErrorKey(err)))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4 dark:bg-stone-950 sm:p-0">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:max-h-none sm:overflow-visible sm:p-8 dark:border-stone-800 dark:bg-stone-900"
      >
        <h1 className="mb-2 text-center text-2xl font-bold">{_('auth.welcome')}</h1>
        <p className="mb-6 text-center text-sm text-stone-500">{_('auth.setupSubtitle')}</p>
        <div className="mb-4">
          <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">
            {_('auth.username')}
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              setError(null)
            }}
            required
            maxLength={AUTH_USERNAME_MAX_LENGTH}
            autoComplete="username"
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        <div className="mb-4">
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">
            {_('auth.password')}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            required
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        <div className="mb-6">
          <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">
            {_('auth.confirmPassword')}
          </label>
          <input
            id="confirmPassword"
            type="password"
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
        {error && <p role="alert" aria-live="polite" className="mb-4 text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full">{_('auth.completeSetup')}</Button>
      </form>
    </div>
  )
}
