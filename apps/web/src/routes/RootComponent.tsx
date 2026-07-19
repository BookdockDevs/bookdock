import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'

import { AppShell } from '@/components/layout/AppShell'
import { apiGet } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'
import type { MeRes, SetupRequiredRes } from '@bookdock/shared'

const PUBLIC_PATHS = ['/login', '/setup']

export function RootComponent() {
  const navigate = useNavigate()
  const location = useLocation()
  const setAuth = useAuthStore((s) => s.setAuth)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const token = useAuthStore((s) => s.token)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const isPublic = PUBLIC_PATHS.includes(location.pathname)

    if (isPublic) {
      apiGet<{ data: SetupRequiredRes }>('/auth/setup-required')
        .then((res) => {
          const required = res.data.required
          if (required && location.pathname !== '/setup') {
            navigate({ to: '/setup' })
          }
          if (!required && location.pathname === '/setup') {
            navigate({ to: '/login' })
          }
        })
        .catch(() => undefined)
        .finally(() => setChecking(false))
      return
    }

    apiGet<{ data: MeRes }>('/auth/me')
      .then((res) => {
        setAuth(token, res.data)
      })
      .catch(() => {
        clearAuth()
        navigate({ to: '/login' })
      })
      .finally(() => setChecking(false))
  }, [location.pathname, navigate, setAuth, clearAuth, token])

  if (checking) return null

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
