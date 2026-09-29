/**
 * Library invitation links are `<origin>/library/+<code>`.
 *
 * The path segment states what the code joins, so a future instance-level
 * invitation can own `/instance/+<code>` without colliding, and the leading
 * plus is the widely read "invite me" marker. The code itself is 16-character
 * Crockford base32 (I/L/O/U dropped so it survives being retyped from a
 * screenshot).
 */
export const PENDING_INVITE_KEY = 'bd-pending-invite'

export function isLibraryInviteToken(token: string): boolean {
  return /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/.test(token)
}

/** The route param, plus sign included. */
export function libraryInviteParam(token: string): `+${string}` {
  return `+${token}`
}

export function buildLibraryInviteLink(token: string): string {
  return `${window.location.origin}/library/${libraryInviteParam(token)}`
}
