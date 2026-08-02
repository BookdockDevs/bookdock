import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { authErrorKey } from './errors'
import { useInstanceInfo, useLogin } from './hooks'

export default function Login() {
  const _ = useTranslation()
  const navigate = useNavigate()
  const login = useLogin()
  const { data: instanceData } = useInstanceInfo()
  const allowRegistration = instanceData?.data.allowRegistration ?? false
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await login.mutateAsync({ username, password })
      navigate({ to: '/' })
    } catch (err) {
      setError(_(authErrorKey(err)))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 shadow-sm dark:border-stone-800 dark:bg-stone-900"
      >
        <h1 className="mb-6 text-center text-2xl font-bold">{_('auth.title')}</h1>
        <div className="mb-4">
          <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">{_('auth.username')}</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        <div className="mb-6">
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">{_('auth.password')}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
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
