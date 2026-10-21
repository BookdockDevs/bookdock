export interface ReaderReturn {
  to: '/profile'
  sourceHistoryIndex?: number
  search?: {
    userId?: string
  }
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    readerReturn?: ReaderReturn
  }
}

export function isReaderReturn(value: unknown): value is ReaderReturn {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { to?: unknown; search?: unknown; sourceHistoryIndex?: unknown }
  if (candidate.to !== '/profile') return false
  if (candidate.sourceHistoryIndex !== undefined && typeof candidate.sourceHistoryIndex !== 'number') return false
  if (candidate.search === undefined) return true
  if (!candidate.search || typeof candidate.search !== 'object') return false
  const userId = (candidate.search as { userId?: unknown }).userId
  return userId === undefined || typeof userId === 'string'
}
