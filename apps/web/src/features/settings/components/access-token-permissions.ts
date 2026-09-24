import type { AccessTokenPermission } from '@bookdock/shared'

/**
 * i18n keys for the registry's permission ids. The registry itself keeps English
 * descriptions because it also feeds the generated API reference; the settings UI
 * localizes by id instead of rendering those strings.
 */
export const ACCESS_TOKEN_PERMISSION_LABEL_KEYS: Record<AccessTokenPermission, string> = {
  'book:list': 'settings.tokenPermissionBookList',
  'book:read': 'settings.tokenPermissionBookRead',
  'book:file': 'settings.tokenPermissionBookFile',
  'book:upload': 'settings.tokenPermissionBookUpload',
}
