import { useCallback } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'

export function canNavigateBack(): boolean {
  if (typeof window === 'undefined') return false

  // 1. TanStack Router maintains __TSR_index in location.state
  const state = window.history.state as { __TSR_index?: number } | null
  if (state && typeof state.__TSR_index === 'number') {
    return state.__TSR_index > 0
  }

  // 2. Check document.referrer (matches current origin) with history.length > 1
  if (document.referrer && document.referrer.startsWith(window.location.origin) && window.history.length > 1) {
    return true
  }

  return false
}

export function useBackNavigation(fallback = '/') {
  const router = useRouter()
  const navigate = useNavigate()

  return useCallback(
    (e?: React.MouseEvent) => {
      if (e) {
        if (e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
        e.preventDefault()
      }

      const routerCanGoBack = router?.history?.canGoBack?.()
      const canGo = typeof routerCanGoBack === 'boolean' ? routerCanGoBack : canNavigateBack()

      if (canGo) {
        if (router?.history?.back) {
          router.history.back()
        } else if (typeof window !== 'undefined') {
          window.history.back()
        }
      } else {
        void navigate({ to: fallback })
      }
    },
    [router, navigate, fallback],
  )
}
