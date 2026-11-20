import { prepareRuleTransferExport } from '@bookdock/shared'
import type { ReplacementTransferFile, TocTransferFile } from '@bookdock/shared'

import { notify } from '@/lib/notifications'

export type RuleTransferFile = TocTransferFile | ReplacementTransferFile

export function timestampSuffix(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export function downloadJsonFile(fileName: string, data: RuleTransferFile) {
  const prepared = prepareRuleTransferExport(data)
  if (!prepared.success) {
    notify.error({ key: prepared.reason === 'limit' ? 'settings.ruleExportLimit' : 'settings.ruleExportInvalid' })
    return
  }
  downloadBlob(fileName, new Blob([prepared.text], { type: 'application/json' }))
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
