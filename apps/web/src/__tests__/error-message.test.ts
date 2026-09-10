import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'
import { getUserErrorMessage, getUserErrorNotification } from '@/lib/error-message'

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
