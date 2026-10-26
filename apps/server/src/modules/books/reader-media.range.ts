export function parseMediaRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null
  if (size <= 0 || header.includes(',')) return 'invalid'
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match || (!match[1] && !match[2])) return 'invalid'
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || start > requestedEnd) return 'invalid'
  return { start, end: Math.min(requestedEnd, size - 1) }
}
