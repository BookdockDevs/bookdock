import { extension } from '../platform'

import en from './messages.en'
import zhCN from './messages.zh-CN'

export type { Messages } from './messages.zh-CN'
export type Locale = 'zh-CN' | 'en'

const TABLES: Record<Locale, unknown> = { 'zh-CN': zhCN, en }

/**
 * `zh` reads the Chinese table, anything else English. An empty tag (Node tests, an
 * environment without i18n) falls back to the source language, like the Web app does.
 */
export function pickLocale(tag: string | undefined | null): Locale {
  const value = (tag ?? '').trim()
  if (!value) return 'zh-CN'
  return /^zh$/i.test(value) || /^zh[-_]/i.test(value) ? 'zh-CN' : 'en'
}

/** Browser UI language first: it is what `chrome://extensions` and the store page already follow. */
function detectLocale(): Locale {
  let tag = ''
  try { tag = extension.i18n?.getUILanguage() ?? '' } catch { /* Not available in this runtime. */ }
  if (!tag) {
    try { tag = navigator.language ?? '' } catch { /* Node, or a stripped-down context. */ }
  }
  return pickLocale(tag)
}

export const locale: Locale = detectLocale()

/** Walks `a.b.c` in any message table and fills `{{name}}` placeholders. */
export function lookup(table: unknown, key: string, params?: Record<string, string | number>): string | undefined {
  let value: unknown = table
  for (const part of key.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined
  if (typeof value !== 'string') return undefined
  if (!params) return value
  return value.replace(/{{(\w+)}}/g, (_, name: string) => String(params[name] ?? ''))
}

/** Extension-owned copy only; `undefined` for a key that belongs to the Web app's table. */
export function message(key: string, params?: Record<string, string | number>): string | undefined {
  return lookup(TABLES[locale], key, params)
}

export function t(key: string, params?: Record<string, string | number>): string {
  return message(key, params) ?? key
}

/**
 * Fills `data-i18n`, `data-i18n-placeholder`, `data-i18n-title` and `data-i18n-aria-label` in a
 * static page, so the markup keeps readable defaults while the runtime picks the language.
 */
export function localizeDocument(root: ParentNode = document): void {
  document.documentElement.lang = locale
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    if (node.dataset.i18n) node.textContent = t(node.dataset.i18n)
  }
  for (const node of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    if (node.dataset.i18nPlaceholder) node.placeholder = t(node.dataset.i18nPlaceholder)
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    if (node.dataset.i18nTitle) node.title = t(node.dataset.i18nTitle)
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    if (node.dataset.i18nAriaLabel) node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel))
  }
}
