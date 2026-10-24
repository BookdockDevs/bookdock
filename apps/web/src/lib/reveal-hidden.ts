import { useUiStore } from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'

export async function toggleRevealHidden() {
  const user = useAuthStore.getState().user
  if (!user) return
  const state = useUiStore.getState()
  if (state.revealHiddenUserId !== user.id) return
  state.setRevealHidden(!state.revealHidden)
}

/**
 * Private-library display flag. The owner toggles hidden rows in listings on
 * their own device (ui.store, never synced); guests cannot enable it.
 */
export function withReveal(path: string): string {
  const user = useAuthStore.getState().user
  const state = useUiStore.getState()
  if (!user || state.revealHiddenUserId !== user.id || !state.revealHidden) return path
  return path.includes('?') ? `${path}&showHidden=1` : `${path}?showHidden=1`
}
