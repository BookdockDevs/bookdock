import { create } from 'zustand'

import type { BookFormat } from '@bookdock/shared'

export type LibraryView = 'grid' | 'list'

interface LibraryState {
  view: LibraryView
  search: string
  sortBy: string
  sortOrder: string
  shelfId: string | null
  tagId: string | null
  format: BookFormat | null
  trash: boolean
  setView: (view: LibraryView) => void
  setSearch: (search: string) => void
  setSort: (sortBy: string, sortOrder: string) => void
  setShelfId: (shelfId: string | null) => void
  setTagId: (tagId: string | null) => void
  setFormat: (format: BookFormat | null) => void
  setTrash: (trash: boolean) => void
}

export const useLibraryState = create<LibraryState>((set) => ({
  view: 'grid',
  search: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
  shelfId: null,
  tagId: null,
  format: null,
  trash: false,
  setView: (view) => set({ view }),
  setSearch: (search) => set({ search }),
  setSort: (sortBy, sortOrder) => set({ sortBy, sortOrder }),
  setShelfId: (shelfId) => set({ shelfId, tagId: null, trash: false }),
  setTagId: (tagId) => set({ tagId, shelfId: null, trash: false }),
  setFormat: (format) => set({ format }),
  setTrash: (trash) => set(trash ? { trash: true, shelfId: null, tagId: null } : { trash }),
}))
