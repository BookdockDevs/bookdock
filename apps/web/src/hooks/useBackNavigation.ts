import { useCallback } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'

export function canNavigateBack(): boolean {
  if (typeof window === 'undefined') return false

  // TanStack Router maintains __TSR_index in history state: nonzero means
  // every entry since the document loaded was an in-app SPA navigation, so
  // stepping back cannot leave the app. document.referrer and history.length
  // are deliberately not consulted: they cannot identify the previous
  // entry's destination. See "Page back navigation v1" in architecture.md.
  const state = window.history.state as { __TSR_index?: number } | null
  return !!state && typeof state.__TSR_index === 'number' && state.__TSR_index > 0
}

export function useBackNavigation(fallback = '/') {
  const router = useRouter({ warn: false })
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
        // Replace, not push: the fallback must not leave the dead-end page
        // behind itself as a return loop.
        void navigate({ to: fallback, replace: true })
      }
    },
    [router, navigate, fallback],
  )
}
