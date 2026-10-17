import { create } from 'zustand'

interface SettingsSyncState {
  userId: string | null
  ready: boolean
  failed: boolean
}

// Transient readiness only; settings themselves remain in the existing caches/store.
export const useSettingsSyncStore = create<SettingsSyncState>(() => ({
  userId: null,
  ready: false,
  failed: false,
}))
