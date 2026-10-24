import { create } from 'zustand'

import type { BookFormat } from '@bookdock/shared'

import { useAuthStore } from './auth.store'

interface DownloadTarget {
  id: string
  bookVersionId?: string
  title: string
  format: BookFormat
  versionLabel?: string
}

interface DownloadState {
  target: DownloadTarget[] | null
  userId: string | null
  open: (target: DownloadTarget | DownloadTarget[]) => void
  close: () => void
}

// Only a transient action target lives here; rules and book data stay in Query.
export const useDownloadStore = create<DownloadState>((set) => ({
  target: null,
  userId: null,
  open: (target) => {
    const user = useAuthStore.getState().user
    if (user) set({ target: Array.isArray(target) ? target : [target], userId: user.id })
  },
  close: () => set({ target: null, userId: null }),
}))
