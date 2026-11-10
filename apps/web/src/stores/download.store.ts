import { create } from 'zustand'

import type { BookFormat, ClientBookRef } from '@bookdock/shared'

import { isDeviceBook } from '@/features/reading-data/book-source'

import { useAuthStore } from './auth.store'

interface DownloadTarget {
  ref?: ClientBookRef
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
    const targets = Array.isArray(target) ? target : [target]
    if (!targets.length) return
    const device = targets.filter((item) => isDeviceBook(item.ref))
    const server = targets.filter((item) => !isDeviceBook(item.ref))
    // A device book needs no account; a server book needs its owner to still be
    // signed in. A mixed batch is one dialog, so it opens for a signed-in
    // reader and keeps only the rows this session can actually open otherwise.
    if (server.length && !user) {
      if (device.length) set({ target: device, userId: null })
      return
    }
    set({ target: targets, userId: server.length ? user?.id ?? null : null })
  },
  close: () => set({ target: null, userId: null }),
}))
