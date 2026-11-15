import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { DEVICE_VAULT_SCOPE } from '@/features/local-library/catalog'
import { catalogQueryKey } from '@/features/reading-data/catalog'

import { invalidateDeviceMembershipQueries } from './hooks'

describe('device membership invalidation', () => {
  it('invalidates both hidden-visibility variants of the device taxonomy snapshot', () => {
    const queryClient = new QueryClient()
    const visible = catalogQueryKey(DEVICE_VAULT_SCOPE, 'membership-counts', false)
    const hidden = catalogQueryKey(DEVICE_VAULT_SCOPE, 'membership-counts', true)
    const unrelated = catalogQueryKey(DEVICE_VAULT_SCOPE, 'detail', 'book')
    for (const key of [visible, hidden, unrelated]) queryClient.setQueryData(key, {})

    invalidateDeviceMembershipQueries(queryClient)

    expect(queryClient.getQueryState(visible)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(hidden)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false)
  })
})
