import { apiGet } from '@/api/client'
import { assertSessionEpoch, getSessionEpoch } from '@/lib/session-scope'

export async function guardedRemoteCatalogRead<T>(path: string, signal?: AbortSignal): Promise<T> {
  const epoch = getSessionEpoch()
  signal?.throwIfAborted()
  const response = await apiGet<T>(path, signal)
  signal?.throwIfAborted()
  assertSessionEpoch(epoch)
  return response
}
