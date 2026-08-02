import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'

import { AppShell } from '@/components/layout/AppShell'
import { apiGet, UNAUTHORIZED_EVENT } from '@/api/client'
import { useInstanceInfo, ME_QUERY_KEY } from '@/features/auth/hooks'
import { useAuthStore } from '@/stores/auth.store'
import type { MeRes } from '@bookdock/shared'

const PUBLIC_PATHS = ['/login', '/register', '/setup']

export function RootComponent() {
  const navigate = useNavigate()
  const location = useLocation()
  const setAuth = useAuthStore((s) => s.setAuth)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const pathname = location.pathname
  const isPublic = PUBLIC_PATHS.includes(pathname)

  const instanceQuery = useInstanceInfo()
  const instance = instanceQuery.data?.data

  // Session state comes from the cookie; /auth/me doubles as the guard probe.
  // staleTime 60s preserves the old debounce behavior via the query cache.
  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiGet<{ data: MeRes }>('/auth/me'),
    staleTime: 60_000,
    retry: false,
    // Guest injection is only reachable after initialization, so me is only
    // meaningful once the instance has a password user.
    enabled: !isPublic && Boolean(instance?.initialized),
  })

  useEffect(() => {
    const onUnauthorized = () => {
      if (!PUBLIC_PATHS.includes(window.location.pathname)) {
        navigate({ to: '/login' })
      }
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [navigate])

  useEffect(() => {
    if (!instance) return
    if (!instance.initialized) {
      // Setup is mandatory on first run: the instance always starts with an
      // owner account; guest access can be enabled by the owner afterwards.
      if (pathname !== '/setup') navigate({ to: '/setup' })
      return
    }
    if (pathname === '/setup') {
      navigate({ to: '/login' })
      return
    }
    if (pathname === '/register' && !instance.allowRegistration) {
      navigate({ to: '/login' })
      return
    }
    if (isPublic) return
    if (meQuery.isPending) return
    const me = meQuery.data?.data
    if (me) {
      // Guest-injected sessions carry me.guest; the store keeps the user so
      // settings sync keeps working, and UI branches on the flag.
      setAuth(me)
      return
    }
    clearAuth()
    // No session: guests pass through only when guest access is enabled.
    if (!instance.allowGuestAccess) navigate({ to: '/login' })
  }, [instance, pathname, isPublic, meQuery.isPending, meQuery.data, navigate, setAuth, clearAuth])

  let ready = false
  if (instance) {
    if (!instance.initialized) {
      ready = pathname === '/setup'
    } else if (isPublic) {
      ready = pathname !== '/setup' && !(pathname === '/register' && !instance.allowRegistration)
    } else if (meQuery.isPending) {
      ready = false
    } else if (meQuery.data) {
      ready = true
    } else {
      ready = instance.allowGuestAccess
    }
  }

  if (!ready) return null

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
