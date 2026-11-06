import { connect } from './connect'
import { localizeDocument, t } from './i18n'
import { normalizeInstanceUrl } from './model'
import type { Connection } from './model'
import { extension } from './platform'
import { disconnect, getConnection, listJobs, saveConnection, sweepJobs } from './store'
import { element, errorText, showStatus } from './ui'

// Static markup carries Chinese defaults; this fills it with the detected language.
localizeDocument()

const form = element<HTMLFormElement>('connection-form')
const panel = element<HTMLElement>('connection-panel')
const card = element<HTMLElement>('connection-card')
const setupHeader = element<HTMLElement>('setup-header')
const baseInput = element<HTMLInputElement>('instance-url')
const tokenInput = element<HTMLInputElement>('token')
const revealButton = element<HTMLButtonElement>('show-token')
const editButton = element<HTMLButtonElement>('edit-connection')
const openButton = element<HTMLButtonElement>('open-instance')
const editingHeader = element<HTMLElement>('editing-header')
const cancelEditButton = element<HTMLButtonElement>('cancel-edit')
const disconnectRow = element<HTMLElement>('disconnect-row')
const disconnectButton = element<HTMLButtonElement>('disconnect')
const instanceAnchor = element<HTMLAnchorElement>('instance')
const enabled = element<HTMLInputElement>('enabled')
const autoOpen = element<HTMLInputElement>('auto-open')
const save = element<HTMLButtonElement>('save')

let connection: Connection | undefined
/** Connected accounts stay collapsed: the card is a launcher, not a settings page. */
let editing = false

const SAVE_PRIMARY = 'mt-1 inline-flex h-10 w-full items-center justify-center font-medium tracking-tight rounded-xl border border-stone-900/90 bg-stone-900 px-4 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_2px_rgba(0,0,0,0.12)] transition-all duration-150 ease-out select-none outline-none hover:border-stone-800 hover:bg-stone-800 active:scale-[0.985] active:bg-stone-950 focus-visible:ring-2 focus-visible:ring-stone-400/50 disabled:pointer-events-none disabled:opacity-40 dark:border-white/90 dark:bg-stone-100 dark:text-stone-900 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.25)] dark:hover:bg-white dark:active:bg-stone-200'
const SAVE_SECONDARY = 'mt-1 inline-flex h-10 w-full items-center justify-center font-medium tracking-tight rounded-xl border border-stone-200/90 bg-white px-4 text-sm text-stone-700 shadow-2xs transition-all duration-150 ease-out select-none outline-none hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 active:scale-[0.985] active:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-400/50 disabled:pointer-events-none disabled:opacity-40 dark:border-stone-700/80 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-750 dark:hover:text-stone-100 dark:active:bg-stone-700'

const CONNECT_TIMEOUT_MS = 20_000

function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })
  return Promise.race([task, guard]).finally(() => { if (timer) clearTimeout(timer) })
}

const icon = (body: string) => `<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const EYE = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'
const EYE_OFF = '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>'

function setIcon(button: HTMLButtonElement, body: string, label: string) {
  button.innerHTML = icon(body)
  button.setAttribute('aria-label', label)
  button.title = label
}

async function renderJobs() {
  const list = element('jobs')
  list.replaceChildren()
  const jobs = (await listJobs()).sort((a, b) => b.createdAt - a.createdAt)
  element('jobs-section').hidden = jobs.length === 0
  const seen = new Set<string>()
  for (const job of jobs) {
    if (seen.has(job.batchId)) continue
    seen.add(job.batchId)
    const batch = jobs.filter((item) => item.batchId === job.batchId)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'w-full truncate rounded-lg px-3 py-2 text-left text-sm text-stone-600 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-stone-400 dark:text-stone-300 dark:hover:bg-stone-800'
    const state = batch.some((item) => item.state === 'receiving') ? 'popup.jobReceiving' : batch.some((item) => item.state === 'uploading') ? 'popup.jobUploading' : 'popup.jobView'
    button.textContent = t(state, { count: batch.length })
    button.onclick = () => { void extension.tabs.create({ url: extension.runtime.getURL(`upload.html?batch=${job.batchId}`) }) }
    list.append(button)
  }
}

function renderPanel() {
  const isConnected = Boolean(connection)
  setupHeader.hidden = isConnected
  card.hidden = !isConnected || editing
  panel.hidden = isConnected && !editing
  editingHeader.hidden = !isConnected || !editing
  disconnectRow.hidden = !isConnected || !editing
  editButton.hidden = !isConnected || editing
  openButton.hidden = !isConnected || editing
  element('connected-actions').hidden = !isConnected || editing
}

function isDirty(): boolean {
  if (!connection) return true
  let sameUrl = false
  try { sameUrl = normalizeInstanceUrl(baseInput.value) === connection.baseUrl } catch { return true }
  const typed = tokenInput.value.trim()
  return !sameUrl || (typed !== '' && typed !== connection.token)
}

function renderSave() {
  save.className = connection ? SAVE_SECONDARY : SAVE_PRIMARY
  if (save.disabled) return
  if (!connection) {
    save.textContent = t('popup.connect')
  } else {
    save.textContent = isDirty() ? t('popup.save') : t('popup.saveTest')
  }
}

function renderReveal() {
  const masked = tokenInput.type === 'password'
  setIcon(revealButton, masked ? EYE : EYE_OFF, t(masked ? 'popup.showToken' : 'popup.hideToken'))
  revealButton.setAttribute('aria-pressed', String(!masked))
}

function fillInputs() {
  baseInput.value = connection?.baseUrl ?? ''
  tokenInput.value = connection?.token ?? ''
  tokenInput.type = 'password'
  renderReveal()
}

function openBookdock() {
  if (connection?.baseUrl) void extension.tabs.create({ url: connection.baseUrl })
}

async function render() {
  await sweepJobs()
  connection = await getConnection()
  const badge = document.getElementById('badge')
  if (badge) badge.hidden = !connection
  element('account').textContent = connection ? connection.username : ''
  instanceAnchor.textContent = connection ? connection.baseUrl : ''
  instanceAnchor.href = connection ? connection.baseUrl : '#'
  instanceAnchor.title = connection ? t('popup.openInstanceTitle') : ''
  fillInputs()
  tokenInput.required = !connection
  renderSave()
  enabled.checked = connection?.enabled ?? true
  autoOpen.checked = connection?.autoOpen !== false
  renderPanel()
  if (connection) await renderJobs()
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  if (save.disabled) return
  const saving = isDirty()
  save.disabled = true
  save.textContent = t('popup.saveBusy')
  showStatus('')
  void withTimeout((async () => {
    await connect(baseInput.value, tokenInput.value, { enabled: enabled.checked, autoOpen: autoOpen.checked })
    if (saving) {
      // 用户初次连接或修改了配置：保存成功后切入已连接主卡片
      editing = false
      void extension.runtime.sendMessage({ type: 'bookdock:refresh' }).catch(() => {})
      await render()
    } else {
      // 纯测试连接：保持在编辑模式，在表单内显示“连接正常”
      connection = await getConnection()
      renderSave()
      showStatus(t('popup.connectOk'), 'success')
    }
  })(), CONNECT_TIMEOUT_MS, t('popup.timeout'))
    .catch((error: unknown) => showStatus(errorText(error), 'error'))
    .finally(() => { save.disabled = false; renderSave() })
})

baseInput.addEventListener('input', () => { showStatus(''); renderSave() })
tokenInput.addEventListener('input', () => { showStatus(''); renderSave() })

editButton.onclick = () => {
  editing = true
  showStatus('')
  renderPanel()
}

cancelEditButton.onclick = () => {
  editing = false
  fillInputs()
  renderSave()
  showStatus('')
  renderPanel()
}

openButton.onclick = openBookdock

instanceAnchor.onclick = (event) => {
  if (connection?.baseUrl) {
    event.preventDefault()
    openBookdock()
  }
}

disconnectButton.onclick = () => {
  if (disconnectButton.disabled) return
  disconnectButton.disabled = true
  showStatus('')
  void disconnect()
    .then(async () => {
      connection = undefined
      editing = false
      void extension.runtime.sendMessage({ type: 'bookdock:refresh' }).catch(() => {})
      await render()
    })
    .catch((error: unknown) => showStatus(errorText(error), 'error'))
    .finally(() => { disconnectButton.disabled = false })
}

revealButton.onclick = () => {
  tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password'
  renderReveal()
}

async function patch(values: Partial<Connection>) {
  if (!connection) return
  connection = { ...connection, ...values }
  await saveConnection(connection)
  await extension.runtime.sendMessage({ type: 'bookdock:refresh' }).catch(() => {})
}

enabled.onchange = () => { void patch({ enabled: enabled.checked }).catch((error: unknown) => showStatus(errorText(error), 'error')) }
autoOpen.onchange = () => { void patch({ autoOpen: autoOpen.checked }).catch((error: unknown) => showStatus(errorText(error), 'error')) }

element<HTMLButtonElement>('choose-file').onclick = () => { void extension.tabs.create({ url: extension.runtime.getURL('upload.html') }) }

void render().catch((error: unknown) => showStatus(errorText(error), 'error'))
