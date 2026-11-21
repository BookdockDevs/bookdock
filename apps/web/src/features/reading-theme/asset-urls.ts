import { useEffect, useState } from 'react'

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

import { fetchThemeAssetFromServer } from '@/api/hooks/useReadingThemes'

import { ThemeAssetStore } from './assets'

const store = new ThemeAssetStore()

interface ThemeAssetUrlState {
  /** Blob URLs currently held by at least one consumer, keyed `scope\0id` */
  urls: Record<string, string>
}

const useThemeAssetUrlStore = create<ThemeAssetUrlState>(() => ({ urls: {} }))

const refs = new Map<string, number>()
const inflight = new Map<string, Promise<string | null>>()

function poolKey(scope: string, id: string): string {
  return `${scope}\u0000${id}`
}

function bumpRef(key: string): void {
  refs.set(key, (refs.get(key) ?? 0) + 1)
}

/** Acquire a temporary blob URL for a theme asset of one scope. Concurrent
 *  acquirers share one URL; each must call releaseThemeAssetUrl exactly once.
 *  Resolves null when the asset record or its file is gone. */
function acquireThemeAssetUrl(scope: string, id: string): Promise<string | null> {
  const key = poolKey(scope, id)
  const held = useThemeAssetUrlStore.getState().urls[key]
  if (held) {
    bumpRef(key)
    return Promise.resolve(held)
  }
  const pending = inflight.get(key)
  if (pending) return pending.then((url) => {
    if (url) bumpRef(key)
    return url
  })
  const created = store.getBlob(scope, id).then(async (blob) => {
    const resolved = blob ?? await fetchThemeAssetFromServer(id).catch(() => null)
    if (!resolved) return null
    const url = URL.createObjectURL(resolved)
    bumpRef(key)
    useThemeAssetUrlStore.setState((s) => ({ urls: { ...s.urls, [key]: url } }))
    return url
  }).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, created)
  return created
}

function releaseThemeAssetUrl(scope: string, id: string): void {
  const key = poolKey(scope, id)
  const remaining = (refs.get(key) ?? 0) - 1
  if (remaining > 0) {
    refs.set(key, remaining)
    return
  }
  refs.delete(key)
  const url = useThemeAssetUrlStore.getState().urls[key]
  if (url === undefined) return
  useThemeAssetUrlStore.setState((s) => {
    const { [key]: _released, ...urls } = s.urls
    return { urls }
  })
  URL.revokeObjectURL(url)
}

/** Pin an unsaved image while the editor owns its draft. */
export function stageThemeAsset(scope: string, id: string, blob: Blob): () => void {
  const key = poolKey(scope, id)
  const url = URL.createObjectURL(blob)
  bumpRef(key)
  useThemeAssetUrlStore.setState((s) => ({ urls: { ...s.urls, [key]: url } }))
  return () => releaseThemeAssetUrl(scope, id)
}

/** Hold one pooled URL per listed theme asset for the lifetime of the calling
 *  component. `missing` lists ids whose record or file no longer resolves. */
export function useThemeAssetUrls(scope: string, ids: string[]): { urls: Record<string, string>; missing: string[] } {
  const key = ids.join('\u0000')
  const [failure, setFailure] = useState<{ scope: string; key: string; ids: string[] }>()
  const scopedUrls = useThemeAssetUrlStore(useShallow(({ urls }) => {
    const result: Record<string, string> = Object.create(null)
    for (const id of key ? key.split('\u0000') : []) {
      const url = urls[poolKey(scope, id)]
      if (url) result[id] = url
    }
    return result
  }))
  useEffect(() => {
    if (!key) return
    let released = false
    const acquired: string[] = []
    const failed: string[] = []
    void Promise.all(key.split('\u0000').map(async (id) => {
      const url = await acquireThemeAssetUrl(scope, id).catch(() => null)
      if (!url) {
        failed.push(id)
        return
      }
      // Unmounted before the acquire resolved: give the reference straight back
      if (released) releaseThemeAssetUrl(scope, id)
      else acquired.push(id)
    })).then(() => {
      if (!released) setFailure({ scope, key, ids: failed })
    }).catch(() => {})
    return () => {
      released = true
      acquired.forEach((id) => releaseThemeAssetUrl(scope, id))
    }
  }, [scope, key])
  return { urls: scopedUrls, missing: failure?.scope === scope && failure.key === key ? failure.ids : [] }
}
