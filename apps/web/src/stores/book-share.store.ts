import { create } from 'zustand'

import type { BookFormat } from '@bookdock/shared'

import { useAuthStore } from './auth.store'

export interface BookShareTarget {
  versionId: string
  libraryId?: string
  title: string
  format: BookFormat
  versionLabel?: string
}

interface BookShareState {
  target: (BookShareTarget & { userId: string }) | null
  open: (target: BookShareTarget) => void
  close: () => void
}

export const useBookShareStore = create<BookShareState>((set) => ({
  target: null,
  open: (target) => {
    const user = useAuthStore.getState().user
    if (user) set({ target: { ...target, userId: user.id } })
  },
  close: () => set({ target: null }),
}))
