import { useSyncExternalStore } from 'react'

const COARSE_POINTER_QUERY = '(pointer: coarse)'

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(COARSE_POINTER_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

export function useIsTouch() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COARSE_POINTER_QUERY).matches,
    () => false,
  )
}
