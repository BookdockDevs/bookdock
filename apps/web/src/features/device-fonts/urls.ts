import { useEffect, useState } from 'react'

import { create } from 'zustand'

import { DeviceFontStore } from './db'

const store = new DeviceFontStore()

export interface DeviceFontUrlState {
  /** Blob URLs currently held by at least one consumer */
  urls: Record<string, string>
}

export const useDeviceFontUrlStore = create<DeviceFontUrlState>(() => ({ urls: {} }))

const refs = new Map<string, number>()
const inflight = new Map<string, Promise<string | null>>()

function bumpRef(id: string): void {
  refs.set(id, (refs.get(id) ?? 0) + 1)
}

/** Acquire a temporary blob URL for a device font. Concurrent acquirers share
 *  one URL; each must call releaseDeviceFontUrl exactly once. Resolves null
 *  when the font record or its file is gone. */
export function acquireDeviceFontUrl(id: string): Promise<string | null> {
  const held = useDeviceFontUrlStore.getState().urls[id]
  if (held) {
    bumpRef(id)
    return Promise.resolve(held)
  }
  const pending = inflight.get(id)
  if (pending) return pending.then((url) => {
    if (url) bumpRef(id)
    return url
  })
  const created = store.getBlob(id).then((blob) => {
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    bumpRef(id)
    useDeviceFontUrlStore.setState((s) => ({ urls: { ...s.urls, [id]: url } }))
    return url
  }).finally(() => {
    inflight.delete(id)
  })
  inflight.set(id, created)
  return created
}

export function releaseDeviceFontUrl(id: string): void {
  const remaining = (refs.get(id) ?? 0) - 1
  if (remaining > 0) {
    refs.set(id, remaining)
    return
  }
  refs.delete(id)
  const url = useDeviceFontUrlStore.getState().urls[id]
  if (url === undefined) return
  useDeviceFontUrlStore.setState((s) => {
    const { [id]: _released, ...urls } = s.urls
    return { urls }
  })
  URL.revokeObjectURL(url)
}

export function peekDeviceFontUrl(id: string): string | null {
  return useDeviceFontUrlStore.getState().urls[id] ?? null
}

/** Hold one pooled URL per listed device font for the lifetime of the calling
 *  component. `missing` lists ids whose record or file no longer resolves. */
export function useDeviceFontUrls(ids: string[]): { urls: Record<string, string>; missing: string[] } {
  const urls = useDeviceFontUrlStore((s) => s.urls)
  const key = ids.join('\u0000')
  const [missing, setMissing] = useState<string[]>([])
  useEffect(() => {
    if (!key) {
      setMissing([])
      return
    }
    let released = false
    const acquired: string[] = []
    const failed: string[] = []
    void Promise.all(key.split('\u0000').map(async (id) => {
      // Storage read failures land in `missing` too, so consumers notify and
      // fall back instead of silently rendering with no font applied
      const url = await acquireDeviceFontUrl(id).catch(() => null)
      if (!url) {
        failed.push(id)
        return
      }
      // Unmounted before the acquire resolved: give the reference straight back
      if (released) releaseDeviceFontUrl(id)
      else acquired.push(id)
    })).then(() => {
      if (!released) setMissing(failed)
    }).catch(() => {})
    return () => {
      released = true
      acquired.forEach(releaseDeviceFontUrl)
    }
  }, [key])
  return { urls, missing }
}
