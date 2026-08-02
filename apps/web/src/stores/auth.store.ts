import { create } from 'zustand'

export interface AuthUser {
  id: string
  username: string
  role: string
  /** True for guest-injected sessions (no real login); mirrors MeRes.guest. */
  guest?: boolean
}

interface AuthState {
  user: AuthUser | null
  setAuth: (user: AuthUser) => void
  clearAuth: () => void
}

function readStoredUser(): AuthState['user'] {
  if (typeof window === 'undefined') return null
  try {
    return JSON.parse(localStorage.getItem('bd-user') ?? 'null')
  } catch {
    return null
  }
}

// JWT lives in an HttpOnly cookie; the store only mirrors the user profile for
// UI display so a reload does not flash logged-out chrome before /auth/me resolves.
export const useAuthStore = create<AuthState>((set) => ({
  user: readStoredUser(),
  setAuth: (user) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('bd-user', JSON.stringify(user))
    }
    set({ user })
  },
  clearAuth: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('bd-user')
    }
    set({ user: null })
  },
}))
