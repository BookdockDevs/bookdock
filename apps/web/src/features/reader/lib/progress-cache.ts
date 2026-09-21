import type { ReadingProgressRes } from '@bookdock/shared'

export interface ReadingProgressCache {
  data: ReadingProgressRes | null
}

export function mergeProgressSaveCache(
  current: ReadingProgressCache | undefined,
  result: ReadingProgressCache,
): ReadingProgressCache | undefined {
  return result.data ? { data: result.data } : current
}
