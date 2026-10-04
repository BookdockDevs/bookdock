import { describe, expect, it } from 'vitest'

import { getUserDisplayName, useAuthStore } from '../stores/auth.store'
import { useUiStore } from '../stores/ui.store'

describe('getUserDisplayName', () => {
  it('uses the username for a signed-in user', () => {
    expect(getUserDisplayName({ id: 'user-1', username: '小西', role: 'owner' }, '游客')).toBe('小西')
  })

  it('uses the guest label for a guest session', () => {
    expect(getUserDisplayName(null, '游客')).toBe('游客')
  })

  it('keeps anonymous local preferences when identity is checked again', () => {
    useAuthStore.setState({ user: null })
    useUiStore.setState({ view: 'list' })
    useAuthStore.getState().clearAuth()
    expect(useAuthStore.getState().user).toBeNull()
    expect(useUiStore.getState().view).toBe('list')
  })
})
