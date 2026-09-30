import type { AccessTokenPermission } from '@bookdock/shared'

/**
 * i18n keys for the registry's permission ids. The registry itself keeps English
 * descriptions because it also feeds the generated API reference; the settings UI
 * localizes by id instead of rendering those strings.
 */
export const ACCESS_TOKEN_PERMISSION_LABEL_KEYS: Record<AccessTokenPermission, string> = {
  'ext:libraries': 'settings.tokenPermissionExtLibraries',
  'ext:books': 'settings.tokenPermissionExtBooks',
  'ext:book': 'settings.tokenPermissionExtBook',
  'ext:file': 'settings.tokenPermissionExtFile',
  'ext:upload': 'settings.tokenPermissionExtUpload',
  'ext:delete': 'settings.tokenPermissionExtDelete',
}
