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
  const blob = new Blob([prepared.text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
