export interface ReaderReturn {
  to: '/profile'
  sourceHistoryIndex?: number
  search?: {
    userId?: string
    activity?: 'all' | 'idea' | 'review'
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
  const search = candidate.search as { userId?: unknown; activity?: unknown }
  return (search.userId === undefined || typeof search.userId === 'string')
    && (search.activity === undefined || search.activity === 'all' || search.activity === 'idea' || search.activity === 'review')
}
