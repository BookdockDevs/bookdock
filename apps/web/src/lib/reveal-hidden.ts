import { useUiStore } from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'

let beforeHide: (() => Promise<void>) | null = null
let closing = false

export function registerBeforeHideHiddenReader(handler: () => Promise<void>) {
  beforeHide = handler
  return () => { if (beforeHide === handler) beforeHide = null }
}

export async function toggleRevealHidden() {
  const user = useAuthStore.getState().user
  if (!user || closing) return
  const state = useUiStore.getState()
  if (state.revealHiddenUserId !== user.id) return
  if (state.revealHidden) {
    closing = true
    try {
      await beforeHide?.()
      // A save can outlive logout or an account change.
      if (useUiStore.getState().revealHiddenUserId === user.id) state.setRevealHidden(false)
    } finally {
      closing = false
    }
  } else state.setRevealHidden(true)
}

/**
 * Private-vault reveal query flag. The owner toggles reveal mode on their own
 * device (ui.store, never synced); every read that may target a hidden row
 * carries `?showHidden=1` while it is on. Guests can never reveal: the server
 * ignores the flag for guest sessions.
 */
export function withReveal(path: string): string {
  const user = useAuthStore.getState().user
  const state = useUiStore.getState()
  if (!user || state.revealHiddenUserId !== user.id || !state.revealHidden) return path
  return path.includes('?') ? `${path}&showHidden=1` : `${path}?showHidden=1`
}
