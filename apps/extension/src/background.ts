import { t } from './i18n'
import type { DropStatus, Reply } from './model'
import { extension } from './platform'
import { appendChunk, createJobs, finishTransfer, getConnection, removeBatch, sweepJobs } from './store'
import { errorText } from './ui'

async function status(): Promise<DropStatus> {
  const connection = await getConnection()
  return { connected: !!connection, enabled: connection?.enabled ?? false, uploadMaxBytes: connection?.uploadMaxBytes ?? 0, instanceOrigin: connection?.baseUrl }
}

/** A tab that never answers executeScript would otherwise answer the popup "never". */
const REFRESH_TIMEOUT_MS = 4_000

async function refreshTabs(): Promise<void> {
  const current = await status()
  const tabs = await extension.tabs.query({})
  const work = Promise.allSettled(tabs.filter((tab) => tab.id !== undefined && /^https?:/.test(tab.url ?? '')).map(async (tab) => {
    await extension.scripting.executeScript({ target: { tabId: tab.id!, allFrames: true }, files: ['content.js'] }).catch(() => {})
    await extension.tabs.sendMessage(tab.id!, { type: 'bookdock:status-update', data: current }).catch(() => {})
  }))
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, REFRESH_TIMEOUT_MS) })])
  if (timer) clearTimeout(timer)
}

async function handle(value: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (!value || typeof value !== 'object' || !('type' in value)) throw new Error(t('error.generic'))
  const message = value as Record<string, unknown>
  if (sender.id !== extension.runtime.id) throw new Error(t('error.generic'))
  const internal = sender.url?.startsWith(extension.runtime.getURL('')) === true
  const external = sender.tab?.id !== undefined && /^https?:/.test(sender.url ?? '')
  if (!internal && !external) throw new Error(t('error.generic'))
  if (message.type === 'bookdock:refresh') {
    if (!internal) throw new Error(t('error.generic'))
    await refreshTabs()
    return { ok: true }
  }
  if (message.type === 'bookdock:status') return status()
  if (!external) throw new Error(t('error.generic'))
  const owner = { tabId: sender.tab!.id!, frameId: sender.frameId ?? 0 }
  const connection = await getConnection()
  if (!connection || !connection.enabled) throw new Error(t('error.generic'))
  if (message.type === 'bookdock:start-batch') {
    if (!Array.isArray(message.files) || !message.files.every((file: unknown) => file && typeof file === 'object' && 'name' in file && 'size' in file && typeof file.name === 'string' && typeof file.size === 'number')) throw new Error(t('error.generic'))
    if (![message.ignored, message.oversized].every((count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= 1_000_000)) throw new Error(t('error.generic'))
    const jobs = await createJobs(connection, message.files, { sourceTabId: owner.tabId, sourceFrameId: owner.frameId, notices: { ignored: message.ignored as number, oversized: message.oversized as number } })
    const batchId = jobs[0]!.batchId
    // Reply before the tab opens. The content script streams chunks as soon as it has the ids,
    // and awaiting a tab-creation round-trip inside Firefox's event page can leave the reply
    // pending forever — the overlay then sits at "sending" with zero bytes moved, while the
    // upload page shows a job stuck at "receiving".
    void extension.tabs.create({ url: extension.runtime.getURL(`upload.html?batch=${batchId}`) })
      .catch(() => { void removeBatch(batchId).catch(() => {}) })
    return { batchId, jobs: jobs.map((job) => ({ id: job.id, size: job.size })) }
  }
  if (typeof message.id !== 'string' || message.id.length > 64) throw new Error(t('error.generic'))
  if (message.type === 'bookdock:chunk') {
    if (typeof message.index !== 'number' || typeof message.data !== 'string' || !message.data.length || message.data.length > 350_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) throw new Error(t('error.generic'))
    const bytes = Uint8Array.from(atob(message.data), (character) => character.charCodeAt(0))
    await appendChunk(message.id, message.index, bytes, owner)
    return { ok: true }
  }
  if (message.type === 'bookdock:finish') {
    await finishTransfer(message.id, owner)
    return { ok: true }
  }
  throw new Error(t('error.generic'))
}

extension.runtime.onMessage.addListener((message: unknown, sender, respond: (reply: Reply<unknown>) => void) => {
  if (!message || typeof message !== 'object' || !('type' in message) || typeof message.type !== 'string' || !message.type.startsWith('bookdock:') || message.type === 'bookdock:status-update') return
  void handle(message, sender).then((data) => respond({ data }), (error: unknown) => respond({ error: errorText(error) }))
  return true
})

extension.runtime.onInstalled.addListener(() => {
  void extension.alarms.create('cleanup-uploads', { periodInMinutes: 15 })
  void sweepJobs().catch(() => {})
  void refreshTabs().catch(() => {})
})
extension.runtime.onStartup.addListener(() => {
  void extension.alarms.create('cleanup-uploads', { periodInMinutes: 15 })
  void sweepJobs().catch(() => {})
})
extension.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'cleanup-uploads') void sweepJobs().catch(() => {}) })
extension.tabs.onRemoved.addListener((tabId) => { void sweepJobs(tabId).catch(() => {}) })
