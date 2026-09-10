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
  SESSION_NOT_FOUND: 'errors.notFound',
  FONT_NOT_FOUND: 'errors.notFound',
  AVATAR_NOT_FOUND: 'errors.notFound',
  TRANSFORM_NOT_FOUND: 'errors.notFound',
  TOC_RULE_NOT_FOUND: 'errors.notFound',
  BOOK_FILE_MISSING: 'errors.bookFileMissing',
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
  INTERNAL_ERROR: 'errors.operationFailed',
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
