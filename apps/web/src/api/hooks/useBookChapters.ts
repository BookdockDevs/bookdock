import { useQuery } from '@tanstack/react-query'

import type { ChapterListRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { withReveal } from '@/lib/reveal-hidden'
import { useLocalCatalog } from '@/features/reading-data/catalog-source-context'
import { useAuthStore } from '@/stores/auth.store'
import { remoteBookCache, remoteCacheScopeKey } from '@/features/remote-cache/remote-book-cache'
import { useRemoteCacheStore } from '@/features/remote-cache/remote-cache.store'
import { isOfflineOrNetworkError } from '@/features/remote-cache/offline-sync'

export function useBookChapters(bookId: string, enabled = true) {
  const local = useLocalCatalog()
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const isCachedRemote = useRemoteCacheStore((s) => Boolean(!local && s.cached[bookId]))
  return useQuery({
    queryKey: ['chapters', local ? ['local', local.scope.vaultId, bookId] : bookId],
    networkMode: local || isCachedRemote ? 'always' : 'online',
    queryFn: async () => {
      if (local) throw new Error('Use source-owned publication structure for local content')
      try {
        return await apiGet<ChapterListRes>(withReveal(`/books/${bookId}/chapters`))
      } catch (error) {
        if (!isOfflineOrNetworkError(error)) throw error
        const cached = await remoteBookCache.getBookRecord(remoteCacheScopeKey(userId), bookId).catch(() => null)
        if (!cached) throw error
        return { data: cached.chapters }
      }
    },
    enabled: enabled && Boolean(bookId),
  })
}
