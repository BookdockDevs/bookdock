import { ApiError } from '@/api/client'
import type { ToastMessage } from '@/stores/toast.store'

import { ERROR_KEYS } from './error-keys'
export { getErrorKeyByCode } from './error-keys'

export function getUserErrorNotification(error: unknown, fallback = 'errors.operationFailed'): ToastMessage {
  if (error instanceof TypeError) return { key: 'errors.network' }
  if (error instanceof ApiError) {
    if (error.code === 'AI_PROVIDER_ERROR' && error.message.trim()) {
      return { key: 'reader.aiProviderError', params: { message: error.message } }
    }
    return { key: ERROR_KEYS[error.code] ?? fallback }
  }
  if (error instanceof Error && 'category' in error) {
    if (error.category === 'pending-reading') return { key: 'localLibrary.pendingReading' }
    if (error.category === 'conflict') return { key: 'localLibrary.recordConflict' }
    if (error.category === 'storage-full' || error.category === 'storage-unavailable') return { key: 'localLibrary.failed' }
    if (error.category === 'unavailable-content') return { key: 'localLibrary.missing' }
  }
  return { key: fallback }
}

export function getUserErrorMessage(
  error: unknown,
  translate: (key: string, params?: Record<string, string | number>) => string,
  fallback = 'errors.operationFailed',
): string {
  const notification = getUserErrorNotification(error, fallback)
  return translate(notification.key, notification.params)
}

/**
 * Checks if an error represents an access revocation or permission loss (401, 403, or auth failure).
 * Under such errors, cached data MUST NOT be retained as valid displayable content.
 */
export function isAccessRevocationError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return true
    if (
      error.code === 'UNAUTHORIZED' ||
      error.code === 'FORBIDDEN' ||
      error.code === 'ACCOUNT_DISABLED' ||
      error.code === 'INVALID_LIBRARY_PASSWORD' ||
      error.code === 'REGISTRATION_DISABLED' ||
      error.code === 'TRASH_DISABLED'
    ) {
      return true
    }
  }
  const err = error as { status?: number; code?: string }
  if (err.status === 401 || err.status === 403) return true
  if (
    err.code === 'UNAUTHORIZED' ||
    err.code === 'FORBIDDEN' ||
    err.code === 'ACCOUNT_DISABLED' ||
    err.code === 'INVALID_LIBRARY_PASSWORD'
  ) {
    return true
  }
  return false
}
