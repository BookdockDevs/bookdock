import { create } from 'zustand'

interface AuthState {
  token: string | null
  user: { id: string; username: string; role: string } | null
  setAuth: (token: string | null, user: { id: string; username: string; role: string } | null) => void
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

export const useAuthStore = create<AuthState>((set) => ({
  token: typeof window !== 'undefined' ? localStorage.getItem('bd-token') : null,
  user: readStoredUser(),
  setAuth: (token, user) => {
    if (typeof window !== 'undefined') {
      if (token) localStorage.setItem('bd-token', token)
      else localStorage.removeItem('bd-token')
      if (user) localStorage.setItem('bd-user', JSON.stringify(user))
      else localStorage.removeItem('bd-user')
    }
    set({ token, user })
  },
  clearAuth: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('bd-token')
      localStorage.removeItem('bd-user')
    }
    set({ token: null, user: null })
  },
}))
