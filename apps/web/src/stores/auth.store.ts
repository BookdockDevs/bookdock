import { create } from 'zustand'

import { clearStoredSettings } from '@/lib/settings-cache'
import { useUiStore } from './ui.store'

export interface AuthUser {
  id: string
  username: string
  role: string
  /** Content-hash addressed avatar key; see avatarUrl() in lib/avatar */
  avatarKey?: string | null
  createdAt?: number
}

export function getUserDisplayName(user: AuthUser | null | undefined, guestLabel: string): string {
  return user?.username || guestLabel
}

interface AuthState {
  user: AuthUser | null
  setAuth: (user: AuthUser) => void
  updateUser: (patch: Partial<AuthUser>) => void
  clearAuth: () => void
}

function readStoredUser(): AuthState['user'] {
  if (typeof window === 'undefined') return null
  try {
    const stored = JSON.parse(localStorage.getItem('bd-user') ?? 'null')
    return stored?.guest === true || stored?.role === 'guest' ? null : stored
  } catch {
    return null
  }
}

// The session lives in an HttpOnly cookie; the store only mirrors the user profile for
// UI display so a reload does not flash logged-out chrome before /auth/me resolves.
export const useAuthStore = create<AuthState>((set) => ({
  user: readStoredUser(),
  setAuth: (user) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('bd-user', JSON.stringify(user))
    }
    set({ user })
    useUiStore.getState().bindRevealHiddenUser(user.id)
  },
  updateUser: (patch) => {
    set((state) => {
      if (!state.user) return state
      const user = { ...state.user, ...patch }
      if (typeof window !== 'undefined') {
        localStorage.setItem('bd-user', JSON.stringify(user))
      }
      return { user }
    })
  },
  clearAuth: () => {
    if (!useAuthStore.getState().user) return
    // Drop the session before resetting preferences: the settings subscription
    // skips syncing while logged out, so the reset below stays local and can
    // never be mistaken for a user edit and PUT back to the server.
    set({ user: null })
    useUiStore.getState().bindRevealHiddenUser(null)
    if (typeof window !== 'undefined') {
      localStorage.removeItem('bd-user')
      clearStoredSettings()
      // Every server-owned preference returns to its default. Device-adaptation
      // keys (sidebar width, grid columns, page size, and the reader-panel view
      // preferences) are deliberately left alone — they describe the screen, not
      // the reader, so a shared browser keeps them across accounts.
      useUiStore.getState().resetUserScopedPrefs()
    }
  },
}))
