import { describe, expect, it } from 'vitest'

import { getUserDisplayName } from '../stores/auth.store'

describe('getUserDisplayName', () => {
  it('uses the username for a signed-in user', () => {
    expect(getUserDisplayName({ id: 'user-1', username: '小西', role: 'owner' }, '游客')).toBe('小西')
  })

  it('uses the guest label for a guest session', () => {
    expect(getUserDisplayName({ id: 'guest-1', username: 'admin', role: 'guest', guest: true }, '游客')).toBe('游客')
  })
})
