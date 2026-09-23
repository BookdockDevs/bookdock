import type { QueryClient } from '@tanstack/react-query'
import type { SettingsRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'

export const SETTINGS_CACHE_KEY = 'bd-settings-cache'

interface StoredSettingsCache {
  userId: string | null
  data: SettingsRes
}

function getStoredUserId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('bd-user')
    return raw ? (JSON.parse(raw) as { id?: string })?.id ?? null : null
  } catch {
    return null
  }
}

export function readStoredSettings(userId?: string | null): SettingsRes | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSettingsCache | SettingsRes
    if (!parsed || typeof parsed !== 'object') return null
    if ('data' in parsed && typeof (parsed as StoredSettingsCache).data === 'object') {
      const targetUserId = userId !== undefined ? userId : getStoredUserId()
      if (targetUserId && parsed.userId && parsed.userId !== targetUserId) {
        return null
      }
      return parsed.data
    }
    return parsed as SettingsRes
  } catch {
    return null
  }
}

export function writeStoredSettings(data: SettingsRes, userId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    const targetUserId = userId !== undefined ? userId : getStoredUserId()
    const payload: StoredSettingsCache = {
      userId: targetUserId,
      data,
    }
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota errors in private/incognito modes
  }
}

export function clearStoredSettings(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(SETTINGS_CACHE_KEY)
  } catch {
    // ignore
  }
}

export function seedSettingsQuery(client: QueryClient, userId?: string | null): void {
  const cached = readStoredSettings(userId)
  if (cached) {
    client.setQueryData(['settings'], { data: cached }, { updatedAt: 0 })
  }
}

export async function fetchSettings(): Promise<{ data: SettingsRes }> {
  const res = await apiGet<{ data: SettingsRes }>('/settings')
  if (res?.data) {
    writeStoredSettings(res.data)
  }
  return res
}
