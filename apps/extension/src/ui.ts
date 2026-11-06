import { t } from './i18n'

export function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id)
  if (!value) throw new Error(`Missing element: ${id}`)
  return value as T
}

export type StatusTone = 'pending' | 'success' | 'error'

const TONE: Record<StatusTone, string> = {
  // In-flight work stays neutral: green means the connection already happened.
  pending: 'mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400',
  success: 'mt-2 text-xs font-medium leading-5 text-emerald-600 dark:text-emerald-400',
  error: 'mt-2 rounded-xl border border-rose-200/90 bg-rose-50/80 p-3 text-xs leading-5 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300',
}

export function showStatus(message: string, tone: StatusTone = 'pending'): void {
  const target = element('status')
  target.textContent = message
  target.className = TONE[tone]
  target.setAttribute('role', tone === 'error' ? 'alert' : 'status')
  target.hidden = !message
}

export function errorText(error: unknown): string {
  // DOMException's own message is English and aimed at developers; never show it in a zh-CN UI.
  if (error instanceof DOMException) return t(['QuotaExceededError', 'UnknownError'].includes(error.name) ? 'error.storageUnavailable' : 'error.generic')
  return error instanceof Error ? error.message : t('error.generic')
}
