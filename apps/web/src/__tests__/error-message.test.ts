import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'
import { getUserErrorMessage, getUserErrorNotification, isAccessRevocationError } from '@/lib/error-message'

const translate = (key: string) => key

describe('getUserErrorMessage', () => {
  it('maps known API errors to localized keys', () => {
    expect(getUserErrorMessage(new ApiError('BOOK_NOT_FOUND', 'internal message'), translate)).toBe('errors.bookNotFound')
    expect(getUserErrorMessage(new ApiError('FORBIDDEN', 'internal message'), translate)).toBe('errors.forbidden')
  })

  it('uses a network message for fetch failures', () => {
    expect(getUserErrorMessage(new TypeError('Failed to fetch'), translate)).toBe('errors.network')
  })

  it('does not expose unknown error messages', () => {
    expect(getUserErrorMessage(new Error('database details'), translate)).toBe('errors.operationFailed')
  })

  it('maps known API errors to notification descriptors', () => {
    expect(getUserErrorNotification(new ApiError('UPLOAD_TOO_LARGE', 'internal message'))).toEqual({ key: 'errors.uploadTooLarge' })
    expect(getUserErrorNotification(new ApiError('SHELF_NOT_FOUND', 'internal message'))).toEqual({ key: 'errors.notFound' })
    expect(getUserErrorNotification(new ApiError('SHELF_NAME_TAKEN', 'internal message'))).toEqual({ key: 'errors.shelfNameTaken' })
    expect(getUserErrorNotification(new ApiError('TAG_NAME_TAKEN', 'internal message'))).toEqual({ key: 'errors.tagNameTaken' })
  })

  it('keeps a caller-provided fallback for unmapped errors', () => {
    expect(getUserErrorNotification(new ApiError('AI_TIMEOUT', 'internal message'), 'reader.aiRequestFailed')).toEqual({ key: 'reader.aiRequestFailed' })
  })
})

describe('isAccessRevocationError', () => {
  it('identifies 401 and 403 status codes as access revocation', () => {
    expect(isAccessRevocationError(new ApiError('ANY_ERROR', 'msg', undefined, 401))).toBe(true)
    expect(isAccessRevocationError(new ApiError('ANY_ERROR', 'msg', undefined, 403))).toBe(true)
    expect(isAccessRevocationError({ status: 401 })).toBe(true)
    expect(isAccessRevocationError({ status: 403 })).toBe(true)
  })

  it('identifies permission and auth error codes', () => {
    expect(isAccessRevocationError(new ApiError('UNAUTHORIZED', 'msg'))).toBe(true)
    expect(isAccessRevocationError(new ApiError('FORBIDDEN', 'msg'))).toBe(true)
    expect(isAccessRevocationError(new ApiError('ACCOUNT_DISABLED', 'msg'))).toBe(true)
    expect(isAccessRevocationError(new ApiError('INVALID_LIBRARY_PASSWORD', 'msg'))).toBe(true)
  })

  it('returns false for transient network or business errors', () => {
    expect(isAccessRevocationError(null)).toBe(false)
    expect(isAccessRevocationError(undefined)).toBe(false)
    expect(isAccessRevocationError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isAccessRevocationError(new ApiError('BOOK_NOT_FOUND', 'msg', undefined, 404))).toBe(false)
    expect(isAccessRevocationError(new ApiError('INTERNAL_ERROR', 'msg', undefined, 500))).toBe(false)
  })
})
