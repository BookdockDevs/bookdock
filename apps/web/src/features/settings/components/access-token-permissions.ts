import type { AccessTokenPermission, AccessTokenPermissionDefinition } from '@bookdock/shared'
import { ACCESS_TOKEN_PERMISSION_REGISTRY } from '@bookdock/shared'

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

export interface PermissionGroup {
  id: string
  labelKey: string
  descKey?: string
  permissions: readonly AccessTokenPermissionDefinition[]
}

const KNOWN_GROUPS: { id: string; labelKey: string; descKey?: string }[] = [
  {
    id: 'book',
    labelKey: 'settings.tokenGroupBooks',
    descKey: 'settings.tokenGroupBooksDesc',
  },
]

/**
 * Automatically categorizes permissions into groups.
 * Any future permission added to ACCESS_TOKEN_PERMISSION_REGISTRY will be
 * grouped by its prefix (e.g. 'shelf:read' -> 'shelf') and displayed properly
 * without requiring manual UI rewrites.
 */
export function getCategorizedPermissions(): PermissionGroup[] {
  const groupMap = new Map<string, AccessTokenPermissionDefinition[]>()

  for (const item of ACCESS_TOKEN_PERMISSION_REGISTRY) {
    const scope = item.id.includes(':') ? item.id.split(':')[0]! : 'other'
    const existing = groupMap.get(scope) ?? []
    existing.push(item)
    groupMap.set(scope, existing)
  }

  const result: PermissionGroup[] = []

  // Add known groups first in order
  for (const known of KNOWN_GROUPS) {
    const perms = groupMap.get(known.id)
    if (perms && perms.length > 0) {
      result.push({
        id: known.id,
        labelKey: known.labelKey,
        descKey: known.descKey,
        permissions: perms,
      })
      groupMap.delete(known.id)
    }
  }

  // Add any dynamic/future groups
  for (const [scope, perms] of groupMap.entries()) {
    result.push({
      id: scope,
      labelKey: `settings.tokenGroup_${scope}`,
      permissions: perms,
    })
  }

  return result
}

/** Check if a permission is read-only (for the 'Read Only' preset) */
export function isReadOnlyPermission(def: AccessTokenPermissionDefinition): boolean {
  return def.endpoints.every((ep) => ep.startsWith('GET ') || ep.startsWith('HEAD '))
}
