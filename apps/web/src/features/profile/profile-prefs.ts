import { create } from 'zustand'

export interface ProfilePrefs {
  showStats: boolean
  showShowcase: boolean
  isPublic: boolean
  setShowStats: (show: boolean) => void
  setShowShowcase: (show: boolean) => void
  setIsPublic: (isPublic: boolean) => void
}

const STORAGE_KEY = 'bd-profile-prefs'

interface StoredPrefs {
  showStats?: boolean
  showShowcase?: boolean
  isPublic?: boolean
}

function readStoredPrefs(): StoredPrefs {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function savePrefs(patch: StoredPrefs) {
  if (typeof window === 'undefined') return
  try {
    const current = readStoredPrefs()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }))
  } catch {
    // Ignore quota or private-browsing errors
  }
}

export const useProfilePrefs = create<ProfilePrefs>((set) => {
  const initial = readStoredPrefs()
  return {
    showStats: initial.showStats ?? true,
    showShowcase: initial.showShowcase ?? true,
    isPublic: initial.isPublic ?? true,
    setShowStats: (showStats) => {
      savePrefs({ showStats })
      set({ showStats })
    },
    setShowShowcase: (showShowcase) => {
      savePrefs({ showShowcase })
      set({ showShowcase })
    },
    setIsPublic: (isPublic) => {
      savePrefs({ isPublic })
      set({ isPublic })
    },
  }
})
