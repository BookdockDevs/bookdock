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
