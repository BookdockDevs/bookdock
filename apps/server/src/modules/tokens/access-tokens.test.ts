import { describe, expect, it } from 'vitest'

import { ACCESS_TOKEN_PERMISSION_REGISTRY, matchesEndpointPattern, requiredPermissionFor } from '@bookdock/shared'

describe('access token permission registry', () => {
  it('maps every declared endpoint back to exactly its own permission', () => {
    for (const entry of ACCESS_TOKEN_PERMISSION_REGISTRY) {
      for (const pattern of entry.endpoints) {
        const [method, path] = pattern.split(' ')
        expect(requiredPermissionFor(method!, path!)).toBe(entry.id)
      }
    }
  })

  it('matches a `:param` segment against exactly one non-empty path segment', () => {
    expect(matchesEndpointPattern('GET', '/api/v1/books/abc', 'GET /api/v1/books/:id')).toBe(true)
    expect(matchesEndpointPattern('GET', '/api/v1/books/abc/file', 'GET /api/v1/books/:id')).toBe(false)
    expect(matchesEndpointPattern('GET', '/api/v1/books/', 'GET /api/v1/books/:id')).toBe(false)
    expect(matchesEndpointPattern('GET', '/api/v1/books/abc/extra', 'GET /api/v1/books/:id')).toBe(false)
    expect(matchesEndpointPattern('POST', '/api/v1/books/abc', 'GET /api/v1/books/:id')).toBe(false)
  })

  it('never treats a wildcard as a match', () => {
    expect(matchesEndpointPattern('GET', '/api/v1/books/abc', 'GET /api/v1/*')).toBe(false)
    expect(matchesEndpointPattern('GET', '/api/v1/books/abc/file', 'GET /api/v1/books/*')).toBe(false)
  })

  it('splits the file endpoint across GET and HEAD under one permission', () => {
    expect(requiredPermissionFor('GET', '/api/v1/ext/books/abc/file')).toBe('ext:file')
    expect(requiredPermissionFor('HEAD', '/api/v1/ext/books/abc/file')).toBe('ext:file')
  })

  it('opens the identity probe to any valid token', () => {
    expect(requiredPermissionFor('GET', '/api/v1/auth/me')).toBeNull()
  })

  it('defaults to denying everything unregistered, including owner-only endpoints', () => {
    // The Web API is no longer reachable with a token at all: an external client
    // uses /api/v1/ext, so opening the sidebar-shaped /books routes would put
    // readStatus, progress and a single-valued shelfId back on the wire.
    expect(requiredPermissionFor('GET', '/api/v1/books')).toBeUndefined()
    expect(requiredPermissionFor('GET', '/api/v1/books/abc')).toBeUndefined()
    expect(requiredPermissionFor('DELETE', '/api/v1/books/abc')).toBeUndefined()
    expect(requiredPermissionFor('POST', '/api/v1/books')).toBeUndefined()
    expect(requiredPermissionFor('GET', '/api/v1/libraries')).toBeUndefined()
    expect(requiredPermissionFor('GET', '/api/v1/libraries/lib1/books')).toBeUndefined()
    expect(requiredPermissionFor('PATCH', '/api/v1/auth/instance')).toBeUndefined()
    expect(requiredPermissionFor('GET', '/api/v1/tokens')).toBeUndefined()
  })

  it('gives every ext endpoint its own permission', () => {
    // One permission per endpoint, so a token can be narrowed to exactly the
    // operations it needs. Downloading is the one worth separating: a token that
    // can enumerate a library but not pull its files cannot exfiltrate it.
    expect(requiredPermissionFor('GET', '/api/v1/ext/libraries')).toBe('ext:libraries')
    expect(requiredPermissionFor('GET', '/api/v1/ext/books')).toBe('ext:books')
    expect(requiredPermissionFor('GET', '/api/v1/ext/books/v1')).toBe('ext:book')
    expect(requiredPermissionFor('GET', '/api/v1/ext/books/v1/file')).toBe('ext:file')
    expect(requiredPermissionFor('HEAD', '/api/v1/ext/books/v1/file')).toBe('ext:file')
    expect(requiredPermissionFor('POST', '/api/v1/ext/books')).toBe('ext:upload')
    expect(requiredPermissionFor('DELETE', '/api/v1/ext/books/v1')).toBe('ext:delete')
    // A longer path is a different shape, not a near-miss.
    expect(requiredPermissionFor('GET', '/api/v1/ext/books/v1/extra')).toBeUndefined()
    expect(requiredPermissionFor('PUT', '/api/v1/ext/books/v1')).toBeUndefined()
    expect(requiredPermissionFor('PATCH', '/api/v1/ext/books/v1')).toBeUndefined()
  })

  it('keeps the reader out of the ext surface entirely', () => {
    // Chapter bodies and TOCs are closed on purpose: ext:file already hands over
    // the whole file, so opening these would withhold nothing while making the
    // granted surface look narrower than it is.
    expect(requiredPermissionFor('GET', '/api/v1/ext/books/v1/content')).toBeUndefined()
    expect(requiredPermissionFor('GET', '/api/v1/ext/books/v1/chapters')).toBeUndefined()
    expect(requiredPermissionFor('GET', '/api/v1/ext/books/v1/chapters/0')).toBeUndefined()
    // Restore and permanent deletion stay in the Web, so ext:delete can only
    // ever produce a recoverable state.
    expect(requiredPermissionFor('POST', '/api/v1/ext/books/v1/restore')).toBeUndefined()
    expect(requiredPermissionFor('DELETE', '/api/v1/ext/books/v1/permanent')).toBeUndefined()
  })

  it('keeps the Legado facade out of reach of an operation-scoped token', () => {
    // The book source authenticates with its own bd_src_ key, which the guard
    // resolves on its own branch. A bd_ token must not be able to walk in
    // through the registry instead, and the discovery endpoints added for the
    // library model are no exception.
    for (const path of [
      '/api/v1/legado/search',
      '/api/v1/legado/explore/config',
      '/api/v1/legado/explore/libraries/lib1',
      '/api/v1/legado/explore/libraries/lib1/categories/c1',
      '/api/v1/legado/explore/libraries/lib1/tags/t1',
      '/api/v1/legado/books/v1',
      '/api/v1/legado/books/v1/chapters',
      '/api/v1/legado/books/v1/chapters/0',
    ]) {
      expect(requiredPermissionFor('GET', path)).toBeUndefined()
    }
  })
})
