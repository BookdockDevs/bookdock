import { useUiStore } from '@/stores/ui.store'
import { queryClient } from '@/lib/query-client'

export function toggleRevealHidden() {
  const state = useUiStore.getState()
  state.setRevealHidden(!state.revealHidden)
  void queryClient.invalidateQueries({ queryKey: ['books'] })
  void queryClient.invalidateQueries({ queryKey: ['shelves'] })
  void queryClient.invalidateQueries({ queryKey: ['tags'] })
}

/**
 * Private-vault reveal query flag. The owner toggles reveal mode on their own
 * device (ui.store, never synced); every read that may target a hidden row
 * carries `?showHidden=1` while it is on. Guests can never reveal: the server
 * ignores the flag for guest sessions.
 */
export function withReveal(path: string): string {
  if (!useUiStore.getState().revealHidden) return path
  return path.includes('?') ? `${path}&showHidden=1` : `${path}?showHidden=1`
}
