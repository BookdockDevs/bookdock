import overlayCss from 'virtual:styles'

import { t } from './i18n'
import { CHUNK_BYTES, formatBytes, supportedFile } from './model'
import type { DropRequest, DropStatus, Reply } from './model'
import { extension } from './platform'

const scope = globalThis as typeof globalThis & { bookdockDropInstalled?: boolean }
if (!scope.bookdockDropInstalled) {
  scope.bookdockDropInstalled = true
  install()
}

/**
 * Firefox exposes a dropped file to a content script as the page's own object, so
 * `blob.arrayBuffer()` resolves to a typed array from the page's compartment. Iterating, spreading
 * or even testing it throws "Permission denied to access property constructor" — which killed the
 * transfer on the very first chunk. Copying element by element keeps the bytes in our compartment.
 */
async function chunkBytes(blob: Blob): Promise<Uint8Array> {
  const raw = new Uint8Array(await blob.arrayBuffer())
  const copy = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) copy[index] = raw[index]!
  return copy
}

const ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'

// Mirrors features/library/components/UploadFilesPanel.tsx: same panel, dropzone and row classes.
const CARD = 'w-full max-w-[30rem] rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-stone-900/5'
const ZONE = 'flex h-72 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed text-center transition-all duration-150'
const ZONE_IDLE = `${ZONE} border-stone-300`
const ZONE_ACTIVE = `${ZONE} border-stone-500 bg-stone-100/80`
const ZONE_SENDING = 'flex h-40 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-stone-200 text-center'
const ROW = 'flex items-center gap-3 rounded-xl bg-stone-50 px-3 py-2 text-xs'

const TEMPLATE = `
<div data-card class="${CARD}">
  <div data-zone class="${ZONE_IDLE}">
    <div class="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-500">${ICON}</div>
    <div>
      <p data-title class="text-sm font-medium text-stone-700">${t('overlay.idle')}</p>
      <div data-formats class="mt-2 flex items-center justify-center gap-1.5">
        <span class="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-500">EPUB</span>
        <span class="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-500">TXT</span>
      </div>
      <p data-limit class="mt-1.5 text-xs text-stone-400"></p>
    </div>
  </div>
  <ul data-rows hidden class="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1"></ul>
  <p data-hint hidden class="mt-3 text-center text-xs text-stone-400"></p>
</div>`

interface Overlay {
  root: HTMLElement
  card: HTMLElement
  zone: HTMLElement
  title: HTMLElement
  formats: HTMLElement
  limit: HTMLElement
  hint: HTMLElement
  rows: HTMLElement
}

function install() {
  let state: DropStatus = { connected: false, enabled: false, uploadMaxBytes: 0 }
  let busy = false
  let overlay: Overlay | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined

  function create(): Overlay {
    const host = document.createElement('div')
    host.setAttribute('data-bookdock-drop', '')
    const shadow = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = overlayCss
    const root = document.createElement('div')
    root.setAttribute('role', 'status')
    root.setAttribute('aria-live', 'polite')
    root.className = 'pointer-events-none fixed inset-0 z-[2147483647] flex items-center justify-center p-6 font-sans text-sm'
    // Inline instead of `bg-stone-950/40`: that utility compiles to color-mix(oklch …), and a
    // browser that rejects either function drops the whole declaration. The page then stays
    // undimmed and the card reads as sitting inside whatever panel the site already had. rgba()
    // has no such failure mode. The value is stone-950 at 40%.
    root.style.backgroundColor = 'rgba(12, 10, 9, 0.4)'
    root.innerHTML = TEMPLATE
    shadow.append(style, root)
    document.documentElement.append(host)
    const pick = <T extends HTMLElement>(name: string) => {
      const node = root.querySelector<T>(`[data-${name}]`)
      if (!node) throw new Error(`Missing overlay node: ${name}`)
      return node
    }
    return { root, card: pick('card'), zone: pick('zone'), title: pick('title'), formats: pick('formats'), limit: pick('limit'), hint: pick('hint'), rows: pick('rows') }
  }

  function reveal(): Overlay {
    clearTimeout(hideTimer)
    hideTimer = undefined
    overlay ??= create()
    overlay.root.style.display = 'flex'
    overlay.root.setAttribute('aria-hidden', 'false')
    if (!busy) {
      // Escape or a drag the page swallows can end without a drop/dragleave event.
      clearTimeout(watchdog)
      watchdog = setTimeout(() => { if (!busy) conceal() }, 10_000)
    }
    return overlay
  }

  function conceal() {
    clearTimeout(hideTimer)
    hideTimer = undefined
    if (!overlay) return
    overlay.root.style.display = 'none'
    overlay.root.setAttribute('aria-hidden', 'true')
  }

  function setIdle(view: Overlay) {
    if (busy) return
    view.zone.hidden = false
    view.zone.className = ZONE_IDLE
    view.rows.hidden = true
    view.rows.replaceChildren()
    view.title.textContent = t('overlay.idle')
    view.formats.style.display = 'flex'
    view.limit.style.display = ''
    view.limit.textContent = state.uploadMaxBytes > 0 ? t('overlay.limit', { size: formatBytes(state.uploadMaxBytes) }) : ''
    note(view, '')
  }

  function setActive(view: Overlay, active: boolean) {
    if (busy) return
    view.zone.className = active ? ZONE_ACTIVE : ZONE_IDLE
    view.title.textContent = active ? t('overlay.active') : t('overlay.idle')
  }

  /** Rows match the Web upload panel: name, state, thin progress bar. */
  function showRows(files: File[]): HTMLElement[] {
    const view = reveal()
    view.zone.className = ZONE_SENDING
    view.formats.style.display = 'none'
    view.limit.style.display = 'none'
    view.title.textContent = t('overlay.sending')
    view.rows.hidden = false
    view.rows.replaceChildren()
    return files.map((file) => {
      const row = document.createElement('li')
      row.className = ROW
      row.innerHTML = `<span class="min-w-0 flex-1 truncate text-stone-700"></span><span data-state class="shrink-0 text-xs text-stone-400">${t('overlay.waiting')}</span><span data-track class="w-24 shrink-0"><span class="block h-1.5 overflow-hidden rounded-full bg-stone-200"><span data-bar class="block h-full rounded-full bg-stone-800 transition-all duration-200" style="width:0%"></span></span></span>`
      row.querySelector('span')!.textContent = file.name
      view.rows.append(row)
      return row
    })
  }

  function setRowState(row: HTMLElement, text: string) {
    const state = row.querySelector<HTMLElement>('[data-state]')
    if (state) state.textContent = text
  }

  function setRowProgress(row: HTMLElement, percent: number) {
    const bar = row.querySelector<HTMLElement>('[data-bar]')
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, Math.round(percent)))}%`
  }

  function rowDone(row: HTMLElement) {
    setRowProgress(row, 100)
    setRowState(row, t('overlay.sent'))
    row.querySelector('[data-track]')?.remove()
  }

  /** Transient status line: transfer progress, or why a drop was refused. */
  function note(view: Overlay, text: string, tone: 'muted' | 'error' = 'muted') {
    view.hint.hidden = !text
    view.hint.textContent = text
    view.hint.className = tone === 'error' ? 'mt-3 text-center text-xs text-red-600' : 'mt-3 text-center text-xs text-stone-400'
  }

  function nativeTarget(event: DragEvent): boolean {
    return event.composedPath().some((node) => node instanceof HTMLElement && (
      node.isContentEditable || node.matches('input, textarea, [role="textbox"]') || (node instanceof HTMLLabelElement && node.control instanceof HTMLInputElement && node.control.type === 'file')
    ))
  }

  /** Drag events hide the file name but still expose MIME types; skip drags that clearly carry something else. */
  function bookLike(event: DragEvent): boolean {
    const items = event.dataTransfer?.items
    if (!items?.length) return true
    const types = [...items].filter((item) => item.kind === 'file').map((item) => item.type.toLowerCase())
    if (!types.length) return true
    return types.some((type) => !/^(image|video|audio)\//.test(type) && !/^text\/(html|csv|xml)/.test(type) && !/^application\/(pdf|json|msword|vnd\.|x-msdownload|zip)$/.test(type))
  }

  function accepts(event: DragEvent): boolean {
    return event.isTrusted && state.connected && state.enabled && location.origin !== state.instanceOrigin && !nativeTarget(event) && (event.dataTransfer?.types.includes('Files') ?? false) && bookLike(event)
  }

  function insideCard(event: DragEvent): boolean {
    if (!overlay) return false
    const rect = overlay.card.getBoundingClientRect()
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
  }

  // Reloading the extension orphans every content script already running: chrome.runtime turns
  // undefined while this page keeps its DOM. Report that as "reload this page", never as a crash.
  const REVOKED = t('overlay.revoked')

  function live(): boolean {
    try { return Boolean(extension.runtime?.id) } catch { return false }
  }

  function revoked(error: unknown): boolean {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return /context invalidated|cannot read propert|message port closed/i.test(text)
  }

  /** A reply that never arrives would freeze the overlay at "sending": the event page can die mid-call. */
  function replied<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(t('overlay.stalled'))), 15_000)
      promise.then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error: unknown) => { clearTimeout(timer); reject(error) },
      )
    })
  }

  async function send<T>(message: DropRequest): Promise<T> {
    if (!live()) throw new Error(REVOKED)
    let reply: Reply<T>
    try {
      reply = await replied(extension.runtime.sendMessage(message) as Promise<Reply<T>>)
    } catch (error) {
      if (!revoked(error)) throw error
      state = { ...state, connected: false }
      conceal()
      throw new Error(REVOKED)
    }
    if (!reply || reply.error) throw new Error(reply?.error ?? REVOKED)
    return reply.data as T
  }

  /** The worker is often still booting when the page loads; one retry covers that cold start. */
  function loadStatus(retry: boolean): void {
    void send<DropStatus>({ type: 'bookdock:status' }).then(
      (value) => { state = value },
      // Without this the page stays "not connected" until the popup happens to save something.
      () => { if (retry && live()) setTimeout(() => loadStatus(false), 1_000) },
    )
  }

  if (live()) {
    loadStatus(true)
    try {
      extension.runtime.onMessage.addListener((message: { type?: string; data?: DropStatus }, sender) => {
        if (!live() || sender.id !== extension.runtime.id || message.type !== 'bookdock:status-update' || !message.data) return
        state = message.data
        if (!state.enabled && !busy) conceal()
      })
    } catch {
      // Injected mid-reload: the page needs a refresh before it can talk to the extension.
    }
  }

  async function receive(files: File[]): Promise<void> {
    busy = true
    const view = reveal()
    const supported = files.filter((file) => supportedFile(file.name))
    if (!supported.length) {
      busy = false
      note(view, t('overlay.ignored', { count: files.length }), 'error')
      hideTimer = setTimeout(conceal, 6000)
      return
    }
    const accepted = supported.filter((file) => file.size <= state.uploadMaxBytes)
    if (!accepted.length) {
      busy = false
      note(view, t('overlay.oversized', { size: formatBytes(state.uploadMaxBytes) }), 'error')
      hideTimer = setTimeout(conceal, 6000)
      return
    }
    try {
      const rows = showRows(accepted)
      note(view, '')
      const { jobs } = await send<{ jobs: { id: string; size: number }[] }>({
        type: 'bookdock:start-batch',
        files: accepted.map((file) => ({ name: file.name, size: file.size })),
        ignored: files.length - supported.length,
        oversized: supported.length - accepted.length,
      })
      for (const [position, file] of accepted.entries()) {
        const id = jobs[position]!.id
        const row = rows[position]!
        if (!file.size) { rowDone(row); continue }
        setRowState(row, t('overlay.rowSending'))
        let index = 0
        for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
          const bytes = await chunkBytes(file.slice(offset, offset + CHUNK_BYTES))
          let binary = ''
          for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
          await send({ type: 'bookdock:chunk', id, index: index++, data: btoa(binary) })
          const percent = (offset + bytes.length) / file.size * 100
          setRowProgress(row, percent)
          note(view, t('overlay.progress', { percent: Math.round(percent) }))
        }
        await send({ type: 'bookdock:finish', id })
        rowDone(row)
      }
      note(view, files.length > accepted.length ? t('overlay.donePartial', { sent: accepted.length, ignored: files.length - accepted.length }) : t('overlay.done'))
      hideTimer = setTimeout(conceal, 5000)
    } catch (error) {
      note(view, error instanceof Error ? error.message : t('overlay.failed'), 'error')
      hideTimer = setTimeout(conceal, 8000)
    } finally {
      busy = false
    }
  }

  window.addEventListener('dragover', (event) => {
    if (!accepts(event)) {
      if (!busy) conceal()
      return
    }
    event.preventDefault()
    if (busy) {
      event.dataTransfer!.dropEffect = 'none'
      return
    }
    const view = reveal()
    setIdle(view)
    const inside = insideCard(event)
    event.dataTransfer!.dropEffect = inside ? 'copy' : 'none'
    setActive(view, inside)
  }, true)

  window.addEventListener('dragleave', (event) => {
    if (event.relatedTarget || busy) return
    conceal()
  }, true)

  window.addEventListener('drop', (event) => {
    if (!accepts(event)) { conceal(); return }
    // Swallow every drop: without preventDefault the browser would navigate to the file.
    event.preventDefault()
    event.stopImmediatePropagation()
    if (busy) return
    if (!insideCard(event)) { conceal(); return }
    const files = [...(event.dataTransfer?.files ?? [])]
    if (!files.length) { conceal(); return }
    void receive(files)
  }, true)
}
