// The owner's own profile-page preferences. The server owns these: they live in
// the per-user `profile` settings value and are read through
// `useProfileSettings()`. The store here exists only so logout has something to
// reset — a shared browser must not hand one account another's choices, and the
// localStorage keys these used to own are cleared rather than trusted.
import { create } from 'zustand'

const STORAGE_KEY = 'bd-profile-prefs'

export interface ProfilePrefs {
  showStats: boolean
  showShowcase: boolean
  isPublic: boolean
  /** Back to the defaults; called on logout so prefs do not cross accounts. */
  resetProfilePrefs: () => void
}

export const useProfilePrefs = create<ProfilePrefs>(() => ({
  showStats: true,
  showShowcase: true,
  isPublic: true,
  resetProfilePrefs: () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore storage errors
    }
    useProfilePrefs.setState({ showStats: true, showShowcase: true, isPublic: true })
  },
}))
