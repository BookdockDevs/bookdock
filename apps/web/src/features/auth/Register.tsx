import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH, AUTH_REGISTER_USERNAME_MAX_LENGTH } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { authErrorKey } from './errors'
import { useRegister } from './hooks'

export default function Register() {
  const _ = useTranslation()
  usePageTitle(_('auth.registerTitle'))
  const navigate = useNavigate()
  const register = useRegister()
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
    if (normalizedUsername.length > AUTH_REGISTER_USERNAME_MAX_LENGTH) {
      setError(_('auth.errors.registerUsernameTooLong'))
      return
    }
    if (!password) {
      setError(_('auth.errors.passwordRequired'))
      return
    }
    if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
      setError(_('auth.passwordTooShort', { min: AUTH_PASSWORD_MIN_LENGTH }))
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
      await register.mutateAsync({ username: normalizedUsername, password })
      navigate({ to: '/' })
    } catch (err) {
      setError(_(authErrorKey(err)))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4 dark:bg-stone-950 sm:p-0">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:max-h-none sm:overflow-visible sm:p-8 dark:border-stone-800 dark:bg-stone-900"
      >
        <h1 className="mb-6 text-center text-2xl font-bold">{_('auth.registerTitle')}</h1>
        <div className="mb-4">
          <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">{_('auth.username')}</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              setError(null)
            }}
            required
            maxLength={AUTH_REGISTER_USERNAME_MAX_LENGTH}
            autoComplete="username"
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        <div className="mb-4">
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">{_('auth.password')}</label>
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
          <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">{_('auth.confirmPassword')}</label>
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
        <Button type="submit" className="w-full" disabled={register.isPending}>{_('auth.register')}</Button>
        <p className="mt-4 text-center text-sm text-stone-500">
          <Link to="/login" className="text-stone-700 underline underline-offset-2 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100">
            {_('auth.backToSignIn')}
          </Link>
        </p>
      </form>
    </div>
  )
}
