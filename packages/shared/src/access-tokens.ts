/**
 * Operation-scoped access tokens (ADR-24).
 *
 * This module is the single source of truth for "which API operations a token
 * may perform". It feeds three consumers:
 *
 *   1. guard enforcement (`apps/server/src/middleware/auth.guard.ts`)
 *   2. the create/edit dialog in the Web settings UI
 *   3. the future generated API reference
 *
 * Every endpoint opened to tokens must be declared here. Endpoints absent from
 * this registry are never reachable with a token, and wildcard matching is not
 * allowed. The standing cost of that rule is that this catalog rots silently
 * the moment a new token-facing endpoint is added without an entry.
 *
 * Descriptions are English because they are written for the generated API
 * reference; the Web UI localizes them by permission id instead of rendering
 * these strings.
 */

export const ACCESS_TOKEN_PERMISSIONS = [
  'ext:libraries',
  'ext:books',
  'ext:book',
  'ext:file',
  'ext:upload',
  'ext:delete',
] as const

export const ACCESS_TOKEN_NAME_MAX_LENGTH = 64

export type AccessTokenPermission = (typeof ACCESS_TOKEN_PERMISSIONS)[number]

export type AccessTokenDuration = '90d' | '1y' | 'permanent'

export const ACCESS_TOKEN_DURATIONS = ['90d', '1y', 'permanent'] as const

export interface AccessTokenPermissionDefinition {
  id: AccessTokenPermission
  /** `METHOD /path` patterns; a `:name` segment matches exactly one path segment. */
  endpoints: readonly string[]
  description: string
}

export const ACCESS_TOKEN_PERMISSION_REGISTRY: readonly AccessTokenPermissionDefinition[] = [
  {
    id: 'ext:libraries',
    // Carries each library's head counts and its whole shelf/tag taxonomy, so a
    // client can place an upload without a second round trip to discover ids.
    endpoints: ['GET /api/v1/ext/libraries'],
    description: 'List the libraries the account can browse, with its role, write access, head counts and taxonomy on each.',
  },
  {
    id: 'ext:books',
    endpoints: ['GET /api/v1/ext/books'],
    description: 'List or search books across the browsable libraries, one row per version.',
  },
  {
    id: 'ext:book',
    endpoints: ['GET /api/v1/ext/books/:versionId'],
    description: 'Read one book\'s detail metadata, with the cover thumbnail inlined.',
  },
  {
    id: 'ext:file',
    // HEAD rides with GET because it is the same read, and a client that can
    // fetch bytes can ask for their length.
    endpoints: ['GET /api/v1/ext/books/:versionId/file', 'HEAD /api/v1/ext/books/:versionId/file'],
    // Deliberately separate from the listing: a token that can enumerate a
    // library but not pull its files cannot exfiltrate the library, which is the
    // difference that matters if the token ever lands in a CI log.
    description: 'Download the book file, with range support.',
  },
  {
    id: 'ext:upload',
    endpoints: ['POST /api/v1/ext/books'],
    description: 'Upload a book, optionally into a named library.',
  },
  {
    id: 'ext:delete',
    // Only ever the recoverable delete. The Web owns the trash, so a token cannot
    // leave the library in a state its owner has no way to undo from the UI.
    endpoints: ['DELETE /api/v1/ext/books/:versionId'],
    description: 'Move a book to the trash.',
  },
]

/**
 * Endpoints any valid token may call without holding a permission. `auth/me` is
 * how a token proves its identity and how a client runs a connection test.
 */
export const ACCESS_TOKEN_PERMISSION_FREE_ENDPOINTS: readonly string[] = ['GET /api/v1/auth/me']

/** True when `METHOD /path` matches a registry pattern (`:name` = one path segment). */
export function matchesEndpointPattern(method: string, path: string, pattern: string): boolean {
  const separator = pattern.indexOf(' ')
  if (separator < 0) return false
  if (pattern.slice(0, separator) !== method) return false
  const expected = pattern.slice(separator + 1).split('/')
  const actual = path.split('/')
  if (expected.length !== actual.length) return false
  return expected.every((segment, index) => (segment.startsWith(':') ? actual[index]!.length > 0 : segment === actual[index]))
}

/**
 * The permission required for `METHOD /path`:
 *   - `null` when the endpoint is open to any valid token,
 *   - `undefined` when the endpoint is not open to tokens at all (default deny).
 */
export function requiredPermissionFor(method: string, path: string): AccessTokenPermission | null | undefined {
  if (ACCESS_TOKEN_PERMISSION_FREE_ENDPOINTS.some((pattern) => matchesEndpointPattern(method, path, pattern))) return null
  for (const entry of ACCESS_TOKEN_PERMISSION_REGISTRY) {
    if (entry.endpoints.some((pattern) => matchesEndpointPattern(method, path, pattern))) return entry.id
  }
  return undefined
}
