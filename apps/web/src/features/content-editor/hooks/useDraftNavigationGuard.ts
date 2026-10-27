import { useCallback, useEffect } from 'react'
import { useBlocker, useRouter } from '@tanstack/react-router'

export function useDraftNavigationGuard(dirty: boolean, saving: boolean, bookId: string) {
  const router = useRouter()
  const shouldBlockFn = useCallback(() => dirty || saving, [dirty, saving])
  const blocker = useBlocker({ shouldBlockFn, withResolver: true, enableBeforeUnload: false })

  useEffect(() => {
    if (!dirty && !saving) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty, saving])

  function back() {
    if (router.history.canGoBack()) router.history.back()
    else router.history.push(`/books/${encodeURIComponent(bookId)}`)
  }
  return { back, blocked: blocker.status === 'blocked', proceed: blocker.proceed, reset: blocker.reset }
}
