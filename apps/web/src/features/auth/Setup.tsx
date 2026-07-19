import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { apiPost } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/auth.store'
import { t } from '@/i18n'
import type { SetupRes } from '@bookdock/shared'

export default function Setup() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError(t().auth.passwordMismatch)
      return
    }
    if (password.length < 6) {
      setError(t().auth.passwordTooShort)
      return
    }

    try {
      const res = await apiPost<{ data: SetupRes }>('/auth/setup', { username, password })
      setAuth(res.data.token, res.data.user)
      navigate({ to: '/' })
    } catch {
      setError(t().auth.setupFailed)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 shadow-sm dark:border-stone-800 dark:bg-stone-900"
      >
        <h1 className="mb-2 text-center text-2xl font-bold">{t().auth.welcome}</h1>
        <p className="mb-6 text-center text-sm text-stone-500">{t().auth.setupSubtitle}</p>
        <div className="mb-4">
          <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">
            {t().auth.username}
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        <div className="mb-4">
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">
            {t().auth.password}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        <div className="mb-6">
          <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">
            {t().auth.confirmPassword}
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full">{t().auth.completeSetup}</Button>
      </form>
    </div>
  )
}
