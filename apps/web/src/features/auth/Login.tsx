import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { AUTH_PASSWORD_MAX_LENGTH, AUTH_USERNAME_MAX_LENGTH } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { authErrorKey } from './errors'
import { useInstanceInfo, useLogin } from './hooks'

export default function Login() {
  const _ = useTranslation()
  usePageTitle(_('auth.signIn'))
  const navigate = useNavigate()
  const isLegadoLogin = new URLSearchParams(window.location.search).get('legado') === '1'
  const login = useLogin()
  const { data: instanceData } = useInstanceInfo()
  const allowRegistration = instanceData?.data.allowRegistration ?? false
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<'username' | 'password' | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setErrorField(null)
    const normalizedUsername = username.trim()
    if (!normalizedUsername) {
      setError(_('auth.errors.usernameRequired'))
      setErrorField('username')
      return
    }
    if (normalizedUsername.length > AUTH_USERNAME_MAX_LENGTH) {
      setError(_('auth.errors.usernameTooLong'))
      setErrorField('username')
      return
    }
    if (!password) {
      setError(_('auth.errors.passwordRequired'))
      setErrorField('password')
      return
    }
    if (password.length > AUTH_PASSWORD_MAX_LENGTH) {
      setError(_('auth.errors.passwordTooLong'))
      setErrorField('password')
      return
    }
    try {
      await login.mutateAsync({ username: normalizedUsername, password })
      if (isLegadoLogin) {
        window.location.assign('/')
      } else {
        navigate({ to: '/' })
      }
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
        <h1 className="mb-6 text-center text-2xl font-bold">{_('auth.title')}</h1>
        <div className="mb-4">
          <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">{_('auth.username')}</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              setError(null)
              setErrorField(null)
            }}
            required
            maxLength={AUTH_USERNAME_MAX_LENGTH}
            autoComplete="username"
            aria-invalid={errorField === 'username'}
            aria-describedby={error ? 'login-error' : undefined}
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        <div className="mb-6">
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">{_('auth.password')}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
              setErrorField(null)
            }}
            required
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            autoComplete="current-password"
            aria-invalid={errorField === 'password'}
            aria-describedby={error ? 'login-error' : undefined}
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        {error && <p id="login-error" role="alert" aria-live="polite" className="mb-4 text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={login.isPending}>{_('auth.signIn')}</Button>
        {allowRegistration && (
          <p className="mt-4 text-center text-sm text-stone-500">
            <Link to="/register" className="text-stone-700 underline underline-offset-2 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100">
              {_('auth.registerAccount')}
            </Link>
          </p>
        )}
      </form>
    </div>
  )
}
