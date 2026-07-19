import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { apiPost } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/auth.store'
import { t } from '@/i18n'
import type { LoginRes } from '@bookdock/shared'

export default function Login() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await apiPost<{ data: LoginRes }>('/auth/login', { username, password })
      setAuth(res.data.token, res.data.user)
      navigate({ to: '/' })
    } catch {
      setError('登录失败，请检查用户名和密码')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 shadow-sm dark:border-stone-800 dark:bg-stone-900"
      >
        <h1 className="mb-6 text-center text-2xl font-bold">{t().auth.title}</h1>
        <div className="mb-4">
          <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">{t().auth.username}</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        <div className="mb-6">
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400">{t().auth.password}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
          />
        </div>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full">{t().auth.signIn}</Button>
      </form>
    </div>
  )
}
