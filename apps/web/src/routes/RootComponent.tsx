import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'

import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { apiGet, UNAUTHORIZED_EVENT } from '@/api/client'
import { useInstanceInfo, ME_QUERY_KEY } from '@/features/auth/hooks'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import type { MeRes } from '@bookdock/shared'

const PUBLIC_PATHS = ['/login', '/register', '/setup', ...(import.meta.env.DEV ? ['/dev/update-preview'] : [])]

export function RootComponent() {
  const _ = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const setAuth = useAuthStore((s) => s.setAuth)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const recoveringUnauthorizedSession = useRef(false)
  const pathname = location.pathname
  const isUpdatePreview = import.meta.env.DEV && pathname === '/dev/update-preview'
  const isLegadoLogin = pathname === '/login' && new URLSearchParams(window.location.search).get('legado') === '1'
  const isPublic = PUBLIC_PATHS.includes(pathname)
  const shouldProbeSession = pathname === '/login' || !isPublic

  const instanceQuery = useInstanceInfo()
  const instance = instanceQuery.data?.data

  // Session state comes from the cookie; /auth/me doubles as the guard probe.
  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiGet<{ data: MeRes }>('/auth/me'),
    retry: false,
    // Guest injection is only reachable after initialization, so me is only
    // meaningful once the instance has a password user.
    enabled: shouldProbeSession && Boolean(instance?.initialized),
    refetchOnMount: 'always',
    staleTime: pathname === '/login' ? 0 : 60_000,
  })

  useEffect(() => {
    const onUnauthorized = () => {
      if (PUBLIC_PATHS.includes(window.location.pathname) || recoveringUnauthorizedSession.current) return
      // Several requests can fail together; only the fresh session probe may finish recovery.
      recoveringUnauthorizedSession.current = true
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' })
      void queryClient.resetQueries({ queryKey: ME_QUERY_KEY, exact: true })
      navigate({ to: '/login', replace: true })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [navigate, queryClient])

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
    if (pathname === '/login') {
      if (meQuery.isPending || meQuery.isFetching) return
      const me = meQuery.isError ? undefined : meQuery.data?.data
      if (me) recoveringUnauthorizedSession.current = false
      if (me && me.guest !== true) {
        setAuth(me)
        if (isLegadoLogin) {
          window.location.assign('/')
        } else {
          navigate({ to: '/', replace: true })
        }
      } else clearAuth()
      return
    }
    if (isPublic) return
    if (meQuery.isPending || meQuery.isFetching) return
    const me = meQuery.isError ? undefined : meQuery.data?.data
    if (me) {
      recoveringUnauthorizedSession.current = false
      // Guest-injected sessions carry me.guest; the store keeps the user so
      // settings sync keeps working, and UI branches on the flag.
      setAuth(me)
      return
    }
    clearAuth()
    // No session: guests pass through only when guest access is enabled.
    if (!instance.allowGuestAccess) navigate({ to: '/login' })
  }, [instance, pathname, isPublic, isLegadoLogin, meQuery.isPending, meQuery.isFetching, meQuery.isError, meQuery.data, navigate, setAuth, clearAuth])

  if (instanceQuery.isError && !instance && !isUpdatePreview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4 dark:bg-stone-950">
        <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <p role="alert" className="mb-4 text-sm text-red-600">{_('auth.instanceLoadFailed')}</p>
          <Button type="button" onClick={() => void instanceQuery.refetch()}>{_('auth.retry')}</Button>
        </div>
      </div>
    )
  }

  let ready = false
  if (instance) {
    if (!instance.initialized) {
      ready = pathname === '/setup'
    } else if (isPublic) {
      ready = pathname !== '/setup'
        && !(pathname === '/register' && !instance.allowRegistration)
        && !(pathname === '/login' && (meQuery.isPending || meQuery.isFetching || (meQuery.data && meQuery.data.data.guest !== true)))
    } else if (meQuery.isPending || meQuery.isFetching) {
      ready = false
    } else if (meQuery.data && !meQuery.isError) {
      ready = true
    } else {
      ready = instance.allowGuestAccess
    }
  }
  if (isUpdatePreview) ready = true

  if (!ready) return null

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
