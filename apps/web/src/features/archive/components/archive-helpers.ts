import type { ArchiveBookItem } from '@bookdock/shared'

const readableTextPattern = /[\p{L}\p{N}]/u

export function hasReadableText(value: string | null | undefined): value is string {
  const text = value?.trim() ?? ''
  return text.length > 0 && readableTextPattern.test(text)
}

export function readStatusLabel(readStatus: ArchiveBookItem['readStatus'] | undefined, t: (key: string) => string): string {
  if (!readStatus) return ''
  return t(`library.readStatus${readStatus[0].toUpperCase()}${readStatus.slice(1)}`)
}

export function readSavedChoice<T extends string>(key: string, allowed: readonly T[]): T | null
export function readSavedChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T
export function readSavedChoice<T extends string>(key: string, allowed: readonly T[], fallback?: T): T | null {
  try {
    const saved = localStorage.getItem(key)
    if (saved !== null && (allowed as readonly string[]).includes(saved)) return saved as T
  } catch {
    // Ignore unavailable storage.
  }
  return fallback ?? null
}

export function writeSavedChoice(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore unavailable storage.
  }
}
