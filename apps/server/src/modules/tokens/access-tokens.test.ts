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
    expect(requiredPermissionFor('GET', '/api/v1/books/abc/file')).toBe('book:file')
    expect(requiredPermissionFor('HEAD', '/api/v1/books/abc/file')).toBe('book:file')
  })

  it('opens the identity probe to any valid token', () => {
    expect(requiredPermissionFor('GET', '/api/v1/auth/me')).toBeNull()
  })

  it('defaults to denying everything unregistered, including owner-only endpoints', () => {
    expect(requiredPermissionFor('DELETE', '/api/v1/books/abc')).toBeUndefined()
    expect(requiredPermissionFor('PATCH', '/api/v1/books/abc')).toBeUndefined()
    expect(requiredPermissionFor('GET', '/api/v1/books/abc/content')).toBeUndefined()
    expect(requiredPermissionFor('PATCH', '/api/v1/auth/instance')).toBeUndefined()
    expect(requiredPermissionFor('GET', '/api/v1/tokens')).toBeUndefined()
  })
})
