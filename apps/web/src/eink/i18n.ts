import { app as enApp, auth as enAuth, common as enCommon, errors as enErrors, eink as enEink, library as enLibrary, reader as enReader, settings as enSettings, theme as enTheme } from '../i18n/locales/en.json'
import { app as zhApp, auth as zhAuth, common as zhCommon, errors as zhErrors, eink as zhEink, library as zhLibrary, reader as zhReader, settings as zhSettings, theme as zhTheme } from '../i18n/locales/zh-CN.json'

const en = { app: enApp, auth: enAuth, common: enCommon, errors: enErrors, eink: enEink, library: enLibrary, reader: enReader, settings: enSettings, theme: enTheme }
const zhCN = { app: zhApp, auth: zhAuth, common: zhCommon, errors: zhErrors, eink: zhEink, library: zhLibrary, reader: zhReader, settings: zhSettings, theme: zhTheme }

export function resolveLanguage(query: string | null, stored: string | null, languages: readonly string[]): 'en' | 'zh-CN' {
  const choices = [query, stored, ...languages]
  for (const choice of choices) {
    if (!choice) continue
    if (/^en(?:-|$)/i.test(choice)) return 'en'
    if (/^zh(?:-|$)/i.test(choice)) return 'zh-CN'
  }
  return 'zh-CN'
}

let stored: string | null = null
try { stored = localStorage.getItem('i18nextLng') } catch {}
let language = resolveLanguage(new URLSearchParams(window.location.search).get('lng'), stored, navigator.languages?.length ? navigator.languages : [navigator.language])
document.documentElement.lang = language
export function getLanguage(): 'en' | 'zh-CN' { return language }

export function setLanguage(next: 'en' | 'zh-CN'): void {
  language = next
  document.documentElement.lang = next
  try { localStorage.setItem('i18nextLng', next) } catch {}
  const url = new URL(window.location.href)
  if (url.searchParams.has('lng')) {
    url.searchParams.delete('lng')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  }
}

export function t(key: string, values: Record<string, string | number> = {}): string {
  let value: unknown = language === 'en' ? en : zhCN
  for (const part of key.split('.')) value = (value as Record<string, unknown> | undefined)?.[part]
  if (typeof value !== 'string') return key
  return value.replace(/{{(\w+)}}/g, (_, name: string) => String(values[name] ?? ''))
}
