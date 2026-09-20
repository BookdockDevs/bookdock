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

export const ACCESS_TOKEN_PERMISSIONS = ['book:list', 'book:read', 'book:file', 'book:upload'] as const

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
    id: 'book:list',
    endpoints: ['GET /api/v1/books'],
    description: 'List, search and filter the books in the library.',
  },
  {
    id: 'book:read',
    endpoints: ['GET /api/v1/books/:id'],
    description: 'Read a book\'s detail metadata.',
  },
  {
    id: 'book:file',
    endpoints: ['GET /api/v1/books/:id/file', 'HEAD /api/v1/books/:id/file'],
    description: 'Download or range-read the book file (reader loading and the download button).',
  },
  {
    id: 'book:upload',
    endpoints: ['POST /api/v1/books'],
    description: 'Upload a new book.',
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
