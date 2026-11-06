import webEn from '../../web/src/i18n/locales/en.json'
import webZh from '../../web/src/i18n/locales/zh-CN.json'

import { locale, lookup, message } from './i18n'

const WEB: Record<string, unknown> = { 'zh-CN': webZh, en: webEn }

/**
 * Shared Web components (`UploadFilesPanel`, `ToastStack`) read `library.*` keys through the
 * `@/hooks/useTranslation` alias, which points here. Extension keys win, so one call site can
 * mix both tables; the Web app's own i18next instance is never loaded in the extension.
 */
export function translate(key: string, params?: Record<string, string | number>): string {
  return message(key, params) ?? lookup(WEB[locale], key, params) ?? key
}

export function useTranslation() { return translate }
