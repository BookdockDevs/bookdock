import { create } from 'zustand'

import type { FontPreferences } from '@bookdock/shared'

import { DeviceFontError, DeviceFontStore, type DeviceFontMeta } from './db'

const PRESENTATION_KEY = 'bd-device-font-presentation-v1'

export interface DeviceFontSelection {
  primary: string | null
  cjk: string | null
}

interface PersistedPresentation {
  preferences: FontPreferences
  order: string[]
  selection: DeviceFontSelection
}

export type DeviceFontStatus = 'idle' | 'loading' | 'ready' | 'failed'

interface DeviceFontState {
  status: DeviceFontStatus
  fonts: DeviceFontMeta[]
  /** Device-local display-name/enabled overrides; never synced to the account */
  preferences: FontPreferences
  /** Device-local display order of ALL font ids (unified-shelf rule: device
   *  fonts interleave freely with server fonts). Never synced; empty falls
   *  back to the synced fontOrder. */
  order: string[]
  /** Device-local font selection overriding the account's primary/CJK ids */
  selection: DeviceFontSelection
  ensureLoaded: () => Promise<void>
  importFont: (file: File) => Promise<{ font: DeviceFontMeta; duplicate: boolean }>
  setPreference: (id: string, preference: { displayName?: string; enabled?: boolean }) => void
  removePreference: (id: string) => void
  setOrder: (ids: string[]) => void
  /** Fold a synced fontOrder into the merged display order: every non-device
   *  id (including ones this device has not seen yet) takes its synced
   *  position, and each device font stays attached to the non-device id it
   *  followed. A no-op while the merged order is empty (the synced order
   *  drives display directly). */
  reconcileOrder: (syncedOrder: string[]) => void
  selectPrimary: (id: string | null) => void
  selectCjk: (id: string | null) => void
  /** Clear selection slots referencing the given ids (deleted/disabled fonts) */
  clearSelectionFor: (ids: string[]) => void
  removeFont: (id: string) => Promise<void>
}

const database = new DeviceFontStore()

function defaultPresentation(): PersistedPresentation {
  return { preferences: {}, order: [], selection: { primary: null, cjk: null } }
}

function readPresentation(): PersistedPresentation {
  try {
    const raw = localStorage.getItem(PRESENTATION_KEY)
    if (!raw) return defaultPresentation()
    const parsed = JSON.parse(raw) as Partial<PersistedPresentation>
    return {
      preferences: parsed.preferences && typeof parsed.preferences === 'object' ? parsed.preferences : {},
      order: Array.isArray(parsed.order) ? parsed.order.filter((id) => typeof id === 'string') : [],
      selection: {
        primary: typeof parsed.selection?.primary === 'string' ? parsed.selection.primary : null,
        cjk: typeof parsed.selection?.cjk === 'string' ? parsed.selection.cjk : null,
      },
    }
  } catch {
    return defaultPresentation()
  }
}

function writePresentation(state: Pick<DeviceFontState, 'preferences' | 'order' | 'selection'>): void {
  try {
    localStorage.setItem(PRESENTATION_KEY, JSON.stringify({
      preferences: state.preferences,
      order: state.order,
      selection: state.selection,
    }))
  } catch {
    // Private-mode quota failures keep the in-memory state usable
  }
}

export const useDeviceFontStore = create<DeviceFontState>((set, get) => ({
  ...readPresentation(),
  status: 'idle',
  fonts: [],
  ensureLoaded: async () => {
    if (get().status === 'loading' || get().status === 'ready') return
    set({ status: 'loading' })
    try {
      const fonts = await database.list()
      set({ status: 'ready', fonts })
    } catch {
      set({ status: 'failed' })
    }
  },
  importFont: async (file: File) => {
    const result = await database.import(file)
    set((s) => ({
      status: 'ready',
      fonts: [...s.fonts.filter((f) => f.id !== result.font.id), result.font].sort((a, b) => a.createdAt - b.createdAt),
      // Imports never touch the display order: with no local reorder the font
      // trails naturally, and a drag snapshot is complete by construction —
      // appending to a partial order would promote the import to the front.
    }))
    return result
  },
  setPreference: (id, preference) => {
    set((s) => {
      const preferences = { ...s.preferences, [id]: { ...s.preferences[id], ...preference } }
      writePresentation({ ...s, preferences })
      return { preferences }
    })
  },
  removePreference: (id) => {
    set((s) => {
      const { [id]: _removed, ...preferences } = s.preferences
      writePresentation({ ...s, preferences })
      return { preferences }
    })
  },
  setOrder: (ids) => {
    set((s) => {
      const order = [...new Set(ids)]
      writePresentation({ ...s, order })
      return { order }
    })
  },
  reconcileOrder: (syncedOrder) => {
    set((s) => {
      if (s.order.length === 0 || syncedOrder.length === 0) return s
      const isDeviceId = (id: string) => id.startsWith('device-')
      // Device fonts attach to the non-device id they currently follow, so
      // their interleaved positions survive the re-sorted synced sequence
      const leading: string[] = []
      const followers = new Map<string, string[]>()
      let anchor: string | null = null
      for (const id of s.order) {
        if (isDeviceId(id)) {
          if (anchor === null) leading.push(id)
          else followers.get(anchor)!.push(id)
          continue
        }
        anchor = id
        followers.set(id, [])
      }
      const current = [...followers.keys()]
      const wanted = syncedOrder.filter((id) => !isDeviceId(id))
      // Every synced id takes its synced position (new ones included); local
      // ids the sender does not know keep their relative order at the end
      const ordered = [...wanted, ...current.filter((id) => !wanted.includes(id))]
      const next = [...leading]
      for (const id of ordered) {
        next.push(id)
        next.push(...followers.get(id) ?? [])
      }
      writePresentation({ ...s, order: next })
      return { order: next }
    })
  },
  selectPrimary: (id) => {
    set((s) => {
      const selection = { ...s.selection, primary: id }
      writePresentation({ ...s, selection })
      return { selection }
    })
  },
  selectCjk: (id) => {
    set((s) => {
      const selection = { ...s.selection, cjk: id }
      writePresentation({ ...s, selection })
      return { selection }
    })
  },
  clearSelectionFor: (ids) => {
    const drop = new Set(ids)
    const { selection } = get()
    if ((!selection.primary || !drop.has(selection.primary)) && (!selection.cjk || !drop.has(selection.cjk))) return
    set((s) => {
      const next = {
        primary: s.selection.primary && drop.has(s.selection.primary) ? null : s.selection.primary,
        cjk: s.selection.cjk && drop.has(s.selection.cjk) ? null : s.selection.cjk,
      }
      writePresentation({ ...s, selection: next })
      return { selection: next }
    })
  },
  removeFont: async (id) => {
    await database.delete(id)
    set((s) => {
      const fonts = s.fonts.filter((font) => font.id !== id)
      const { [id]: _removed, ...preferences } = s.preferences
      const order = s.order.filter((existing) => existing !== id)
      const selection = {
        primary: s.selection.primary === id ? null : s.selection.primary,
        cjk: s.selection.cjk === id ? null : s.selection.cjk,
      }
      writePresentation({ preferences, order, selection })
      return { fonts, preferences, order, selection }
    })
  },
}))

export { DeviceFontError }

export function deviceFontCatalogSnapshot(): { fonts: DeviceFontMeta[]; preferences: FontPreferences; order: string[] } {
  const s = useDeviceFontStore.getState()
  return { fonts: s.fonts, preferences: s.preferences, order: s.order }
}
