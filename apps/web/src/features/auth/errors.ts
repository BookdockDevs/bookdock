import { ApiError } from '@/api/client'

// Error code → i18n key mapping for auth/admin flows. Keys live under
// "auth.errors" in the locale files.
const AUTH_ERROR_KEYS: Record<string, string> = {
  UNAUTHORIZED: 'auth.errors.invalidCredentials',
  USERNAME_TAKEN: 'auth.errors.usernameTaken',
  REGISTRATION_DISABLED: 'auth.errors.registrationDisabled',
  ACCOUNT_DISABLED: 'auth.errors.accountDisabled',
  CANNOT_MODIFY_SELF: 'auth.errors.cannotModifySelf',
  LAST_OWNER: 'auth.errors.lastOwner',
}

export function authErrorKey(err: unknown): string {
  if (err instanceof ApiError && AUTH_ERROR_KEYS[err.code]) return AUTH_ERROR_KEYS[err.code]
  return 'auth.errors.generic'
}
