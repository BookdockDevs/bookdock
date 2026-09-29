import { describe, expect, it } from 'vitest'

import { buildLibraryInviteLink, isLibraryInviteToken, libraryInviteParam } from '../features/library/invite-link'

describe('library invite links', () => {
  it('accepts only 16-character Crockford base32 codes', () => {
    expect(isLibraryInviteToken('K7M2QX9V4TN8BZRD')).toBe(true)
    // I/L/O/U are dropped from the alphabet, lowercase is not accepted, and the
    // 64-hex codes from the previous format are no longer valid.
    expect(isLibraryInviteToken('K7M2QX9V4TN8BZ1')).toBe(false)
    expect(isLibraryInviteToken('k7m2qx9v4tn8bzrd')).toBe(false)
    expect(isLibraryInviteToken('a'.repeat(64))).toBe(false)
  })

  it('puts the target and the invitation marker in the path', () => {
    expect(libraryInviteParam('K7M2QX9V4TN8BZRD')).toBe('+K7M2QX9V4TN8BZRD')
    expect(buildLibraryInviteLink('K7M2QX9V4TN8BZRD'))
      .toBe(`${window.location.origin}/library/+K7M2QX9V4TN8BZRD`)
  })
})
