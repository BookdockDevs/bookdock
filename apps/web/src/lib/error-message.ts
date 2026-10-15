import { ApiError } from '@/api/client'
import type { ToastMessage } from '@/stores/toast.store'

const ERROR_KEYS: Record<string, string> = {
  BOOK_NOT_FOUND: 'errors.bookNotFound',
  SHELF_NOT_FOUND: 'errors.notFound',
  SHELF_NAME_TAKEN: 'errors.shelfNameTaken',
  TAG_NOT_FOUND: 'errors.notFound',
  TAG_NAME_TAKEN: 'errors.tagNameTaken',
  USER_NOT_FOUND: 'errors.notFound',
  ANNOTATION_NOT_FOUND: 'errors.notFound',
  CONTENT_FILE_NOT_FOUND: 'contentFiles.unavailable',
  ANNOTATION_TEXT_TOO_LONG: 'annotation.selectionTooLong',
  SESSION_NOT_FOUND: 'errors.notFound',
  FONT_NOT_FOUND: 'errors.notFound',
  AVATAR_NOT_FOUND: 'errors.notFound',
  AVATAR_INVALID_IMAGE: 'settings.avatarProcessFailed',
  AVATAR_ANIMATION_TOO_LARGE: 'settings.avatarAnimationTooLarge',
  REPLACEMENT_NOT_FOUND: 'errors.notFound',
  TOC_RULE_NOT_FOUND: 'errors.notFound',
  BOOK_FILE_MISSING: 'errors.bookFileMissing',
  ALREADY_OWNS_SOURCE: 'library.collectAlready',
  TOKEN_NOT_FOUND: 'errors.notFound',
  LIBRARY_NOT_FOUND: 'errors.notFound',
  LIBRARY_VERSION_NOT_FOUND: 'errors.notFound',
  LIBRARY_BOOK_NOT_FOUND: 'errors.notFound',
  INVALID_LIBRARY_PASSWORD: 'errors.wrongLibraryPassword',
  FORBIDDEN: 'errors.forbidden',
  UNAUTHORIZED: 'errors.unauthorized',
  USERNAME_TAKEN: 'auth.errors.usernameTaken',
  REGISTRATION_DISABLED: 'auth.errors.registrationDisabled',
  ACCOUNT_DISABLED: 'auth.errors.accountDisabled',
  CANNOT_MODIFY_SELF: 'auth.errors.cannotModifySelf',
  LAST_OWNER: 'auth.errors.lastOwner',
  AUTH_RATE_LIMITED: 'auth.errors.rateLimited',
  NOT_FOUND: 'errors.notFound',
  VALIDATION_ERROR: 'errors.invalidInput',
  UPLOAD_TOO_LARGE: 'errors.uploadTooLarge',
  UNSUPPORTED_FORMAT: 'errors.unsupportedFormat',
  NO_EXPORTABLE_TEXT: 'library.downloadNoText',
  UPDATE_IN_PROGRESS: 'errors.updateInProgress',
  UPDATE_NOT_AVAILABLE: 'errors.updateNotAvailable',
  UPDATE_NOT_LAUNCHED: 'errors.updateNotLaunched',
  UPDATE_FAILED: 'errors.updateFailed',
  INTERNAL_ERROR: 'errors.operationFailed',
}

export function getErrorKeyByCode(code: string | null | undefined): string | null {
  return code ? ERROR_KEYS[code] ?? null : null
}

export function getUserErrorNotification(error: unknown, fallback = 'errors.operationFailed'): ToastMessage {
  if (error instanceof TypeError) return { key: 'errors.network' }
  if (error instanceof ApiError) return { key: ERROR_KEYS[error.code] ?? fallback }
  return { key: fallback }
}

export function getUserErrorMessage(
  error: unknown,
  translate: (key: string) => string,
  fallback = 'errors.operationFailed',
): string {
  return translate(getUserErrorNotification(error, fallback).key)
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
