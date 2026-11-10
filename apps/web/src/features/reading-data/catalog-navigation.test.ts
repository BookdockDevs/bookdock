import { describe, expect, it } from 'vitest'

import { catalogBookTarget, catalogHomeTarget } from './catalog-navigation'

describe('catalog navigation', () => {
  it('opens every book through the same reader route', () => {
    const remote = { id: 'same-id' }
    const device = { id: 'same-id', ref: { scope: { kind: 'local' as const, vaultId: 'device' }, bookId: 'same-id' } }
    expect(catalogBookTarget(remote)).toEqual({ to: '/books/$id', params: { id: 'same-id' } })
    // The reader route resolves the book's store itself, so a device book takes
    // the same path as a server book — there is no second shelf to link to.
    expect(catalogBookTarget(device)).toEqual({ to: '/books/$id', params: { id: 'same-id' } })
    expect(catalogBookTarget({ ...device, sourceUnavailable: true })).toEqual({ to: '/books/$id', params: { id: 'same-id' } })
    expect(catalogHomeTarget()).toEqual({ to: '/' })
  })
})
