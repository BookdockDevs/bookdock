import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { useAuthStore } from '@/stores/auth.store'

import { activityQueryKey, invalidateActivityQueries } from './hooks'

describe('activity query invalidation', () => {
  it('invalidates only the signed-in viewer’s personal feed and the affected library feed', async () => {
    const queryClient = new QueryClient()
    useAuthStore.setState({
      user: { id: 'viewer-1', username: 'Reader', role: 'member' },
    })
    const keys = [
      activityQueryKey('viewer-1', 'personal', 'viewer-1', 'all'),
      activityQueryKey('viewer-1', 'personal', 'author-1', 'idea'),
      activityQueryKey('viewer-2', 'personal', 'viewer-2', 'all'),
      activityQueryKey('viewer-1', 'library', 'library-1', 'all'),
      activityQueryKey('viewer-1', 'library', 'library-2', 'all'),
    ]
    for (const key of keys) queryClient.setQueryData(key, { pages: [], pageParams: [] })

    await invalidateActivityQueries(queryClient, 'library-1')

    expect(keys.map((key) => queryClient.getQueryCache().find({ queryKey: key })?.state.isInvalidated))
      .toEqual([true, true, false, true, false])
    queryClient.clear()
  })
})
