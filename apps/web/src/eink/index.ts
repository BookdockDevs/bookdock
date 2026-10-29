import './polyfills'
import '../../public/foliate-js/view.js'
// @ts-expect-error foliate-js is untyped JS
import { EPUB } from '../../public/foliate-js/epub.js'
import type { LibraryListItem } from '@bookdock/shared'

import { markEpubChapterTitle } from '../features/reader/lib/chapter-title'
import { sanitizeCleanReadingMarkup, shouldSkipCleanReadingResource } from '../features/reader/lib/clean-reading'
import { createProgressSync, restoreProgress } from './progress-sync'
import { createNextSectionPrefetch } from './next-section-prefetch'
import { createImageCache } from './image-cache'
import { prepareNextSection } from './prepared-section'
import { getLanguage, setLanguage, t } from './i18n'
import { filterEinkMedia, isEinkMedia } from './media-filter'
import { getShelfLayout } from './shelf-layout'
import { createTextCache } from './text-cache'

const app = document.querySelector<HTMLDivElement>('#app') || document.body.appendChild(document.createElement('div'))
app.id = 'app'

let view: any = null
let book: any = null
let manifest: any = null
let shelfPage = 1
let shelfPageSize = 8
let shelfRendering = false
let shelfResizeTimer: ReturnType<typeof setTimeout> | null = null
let busy = false
let currentCfi = ''
let currentHref = ''
let currentTocLabel = ''
let trackingPosition = false
let ignoreRelocate = false
let progressQueue: any = null
let nextPrefetch: ReturnType<typeof createNextSectionPrefetch> | null = null
let preparedSection: ReturnType<typeof prepareNextSection> | null = null
let accountId = ''
let saveTimer: any = null
let closeReaderPanel: (() => void) | null = null
let replaceReaderView: (() => void) | null = null
let cleanReading = false
let cleanReadingSupported = false
let currentBookId = ''

const THEME_KEY = 'bd-eink-theme'
const FONT_KEY = 'bd-eink-font'
const BOLDNESS_KEY = 'bd-eink-boldness'
const FONT_SIZE_KEY = 'bd-eink-font-size-step'
const MARGIN_KEY = 'bd-eink-margin-step'
const ALIGN_KEY = 'bd-eink-align'
const LINE_HEIGHT_KEY = 'bd-eink-line-height-step'
const PARAGRAPH_SPACING_KEY = 'bd-eink-para-spacing-step'
const LETTER_SPACING_KEY = 'bd-eink-letter-spacing-step'
const SETTINGS_TAB_KEY = 'bd-eink-settings-tab'
const CLEAN_READING_KEY = 'bd-eink-clean-reading'
const TURN_AREA_KEY = 'bd-eink-turn-area'

let turnArea: 'standard' | 'single' | 'disabled' = 'standard'
try {
  const saved = localStorage.getItem(TURN_AREA_KEY)
  if (saved === 'single' || saved === 'disabled') turnArea = saved
} catch {}

try { cleanReading = localStorage.getItem(CLEAN_READING_KEY) === 'true' } catch {}

const FONTS = [
  { id: 'songti', labelKey: 'reader.fontNames.serif', family: 'STSong, "STSong", "Songti SC", "SongTi", "SimSun", serif' },
  { id: 'heiti', labelKey: 'reader.fontNames.sans-serif', family: 'STHeiti, "STHeiti", MYingHei, "MYingHei", "PingFang SC", "Heiti SC", "SimHei", sans-serif' },
]

const BOLDNESS_STROKES = ['0px', '0.2px', '0.4px', '0.6px', '0.8px']
const FONT_SIZES = [16, 18, 20, 22, 25, 28, 31, 35]
const MARGINS = [12, 32, 56]
const LINE_HEIGHTS = [1.25, 1.38, 1.5, 1.68, 1.85]
const PARAGRAPH_SPACINGS = ['0em', '0.3em', '0.6em', '0.9em', '1.2em']
const LETTER_SPACINGS = ['0px', '1.5px', '3px', '4.5px', '6px']

function getActiveFont() {
  try {
    const saved = localStorage.getItem(FONT_KEY)
    if (FONTS.some(f => f.id === saved)) return saved!
  } catch {}
  return 'songti'
}

let activeFont = getActiveFont()

function setFont(fontId: string) {
  activeFont = fontId
  try { localStorage.setItem(FONT_KEY, fontId) } catch {}
}

function getStoredBoldness(): number {
  try {
    const saved = localStorage.getItem(BOLDNESS_KEY)
    if (saved !== null) {
      const val = Number(saved)
      if (val >= 0 && val < BOLDNESS_STROKES.length) return val
    }
  } catch {}
  return 1
}

let boldnessStep = getStoredBoldness()

function setBoldness(step: number) {
  boldnessStep = Math.max(0, Math.min(BOLDNESS_STROKES.length - 1, step))
  try { localStorage.setItem(BOLDNESS_KEY, String(boldnessStep)) } catch {}
}

function getStoredFontSizeStep(): number {
  try {
    const saved = localStorage.getItem(FONT_SIZE_KEY)
    if (saved !== null) {
      const step = Number(saved)
      if (step >= 1 && step <= FONT_SIZES.length) return step
    }
  } catch {}
  return 5
}

let fontSizeStep = getStoredFontSizeStep()

function setFontSizeStep(step: number) {
  fontSizeStep = Math.max(1, Math.min(FONT_SIZES.length, step))
  try {
    localStorage.setItem(FONT_SIZE_KEY, String(fontSizeStep))
  } catch {}
}

function getStoredMarginStep(): number {
  try {
    const saved = localStorage.getItem(MARGIN_KEY)
    if (saved !== null) {
      const step = Number(saved)
      if (Number.isInteger(step) && step >= 0 && step < MARGINS.length) return step
    }
  } catch {}
  return 1
}

let marginStep = getStoredMarginStep()

function setMarginStep(step: number) {
  marginStep = Math.max(0, Math.min(MARGINS.length - 1, step))
  try { localStorage.setItem(MARGIN_KEY, String(marginStep)) } catch {}
}

function getStoredAlign(): 'justify' | 'left' {
  try {
    const saved = localStorage.getItem(ALIGN_KEY)
    if (saved === 'justify' || saved === 'left') return saved
  } catch {}
  return 'justify'
}

let activeAlign = getStoredAlign()

function setAlign(align: 'justify' | 'left') {
  activeAlign = align
  try { localStorage.setItem(ALIGN_KEY, align) } catch {}
}

function getStoredLineHeightStep(): number {
  try {
    const saved = localStorage.getItem(LINE_HEIGHT_KEY)
    if (saved !== null) {
      const step = Number(saved)
      if (Number.isInteger(step) && step >= 0 && step < LINE_HEIGHTS.length) return step
    }
  } catch {}
  return 1
}

let lineHeightStep = getStoredLineHeightStep()

function setLineHeightStep(step: number) {
  lineHeightStep = Math.max(0, Math.min(LINE_HEIGHTS.length - 1, step))
  try { localStorage.setItem(LINE_HEIGHT_KEY, String(lineHeightStep)) } catch {}
}

function getStoredParagraphSpacingStep(): number {
  try {
    const saved = localStorage.getItem(PARAGRAPH_SPACING_KEY)
    if (saved !== null) {
      const val = Number(saved)
      if (val >= 0 && val < PARAGRAPH_SPACINGS.length) return val
    }
  } catch {}
  return 2
}

let paragraphSpacingStep = getStoredParagraphSpacingStep()

function setParagraphSpacingStep(step: number) {
  paragraphSpacingStep = Math.max(0, Math.min(PARAGRAPH_SPACINGS.length - 1, step))
  try { localStorage.setItem(PARAGRAPH_SPACING_KEY, String(paragraphSpacingStep)) } catch {}
}

function getStoredLetterSpacingStep(): number {
  try {
    const saved = localStorage.getItem(LETTER_SPACING_KEY)
    if (saved !== null) {
      const val = Number(saved)
      if (val >= 0 && val < LETTER_SPACINGS.length) return val
    }
  } catch {}
  return 1
}

let letterSpacingStep = getStoredLetterSpacingStep()

function setLetterSpacingStep(step: number) {
  letterSpacingStep = Math.max(0, Math.min(LETTER_SPACINGS.length - 1, step))
  try { localStorage.setItem(LETTER_SPACING_KEY, String(letterSpacingStep)) } catch {}
}

function getStoredSettingsTab(): 'font' | 'layout' | 'other' {
  try {
    const saved = localStorage.getItem(SETTINGS_TAB_KEY)
    if (saved === 'layout' || saved === 'font' || saved === 'other') return saved
  } catch {}
  return 'font'
}

let activeSettingsTab = getStoredSettingsTab()

function setSettingsTab(tab: 'font' | 'layout' | 'other') {
  activeSettingsTab = tab
  try { localStorage.setItem(SETTINGS_TAB_KEY, tab) } catch {}
}

function getActiveTheme() {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'dark' || attr === 'light') return attr
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {}
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: string) {
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem(THEME_KEY, theme) } catch {}
}

applyTheme(getActiveTheme())

async function request(path: string, options?: RequestInit) {
  const response = await fetch('/api/v1' + path, options)
  if (!response.ok) {
    const error: any = new Error(t('eink.requestFailed', { status: response.status }))
    error.status = response.status
    throw error
  }
  return response
}

function queueProgress(position: any) {
  const queue = progressQueue
  if (!queue) return
  queue.stage(position)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void queue.flush() }, 600)
}

async function leaveReader(keepPanel = false) {
  if (!keepPanel) {
    closeReaderPanel?.()
    closeReaderPanel = null
    replaceReaderView = null
  }
  nextPrefetch?.dispose()
  nextPrefetch = null
  preparedSection?.dispose()
  preparedSection = null
  clearTimeout(saveTimer)
  const queue = progressQueue
  progressQueue = null
  trackingPosition = false
  const previousView = view
  const previousBook = book
  view = null
  book = null
  manifest = null
  try { previousView?.close?.() } catch (error) { console.warn('Failed to close reader view', error) }
  try { previousBook?.destroy?.() } catch (error) { console.warn('Failed to release reader resources', error) }
  if (queue) await queue.flush()
}

function initProgressSync(bookId: string, userId: string) {
  return createProgressSync(async (position) => {
    await request(`/progress/${bookId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...position, expectedUserId: userId }),
    })
  })
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K]
function element(tag: string, text?: string, className?: string): HTMLElement
function element(tag: string, text = '', className = ''): HTMLElement {
  const el = document.createElement(tag)
  if (text) el.textContent = text
  if (className) el.className = className
  return el
}

function button(text: string, onClick: (e: MouseEvent) => void, className = ''): HTMLButtonElement {
  const btn = element('button', text, className)
  btn.type = 'button'
  btn.onclick = onClick
  return btn
}

async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
  if (busy) return
  busy = true
  try { return await action() }
  finally { busy = false }
}

function ensureLoadingOverlay(): HTMLDivElement {
  const existing = document.querySelector<HTMLDivElement>('.loading-overlay')
  if (existing) return existing
  const overlay = element('div', '', 'loading-overlay')
  document.body.appendChild(overlay)
  return overlay
}

function showLoading(message = t('reader.loading')) {
  const overlay = ensureLoadingOverlay()
  overlay.replaceChildren()
  const box = element('div', '', 'loading-box')
  box.append(element('div', message, 'loading-text'))
  overlay.append(box)
  overlay.style.display = 'flex'
}

function hideLoading() {
  const overlay = document.querySelector<HTMLDivElement>('.loading-overlay')
  if (overlay) {
    overlay.style.display = 'none'
    overlay.replaceChildren()
  }
}

let titleErrorVersion = 0
function showError(error: any, retryAction?: () => void) {
  titleErrorVersion++
  document.title = t('app.name')
  const overlay = ensureLoadingOverlay()
  overlay.replaceChildren()
  const box = element('div', '', 'loading-box')
  const msg = error?.message || String(error || t('eink.unknownError'))
  box.append(
    element('div', t('eink.errorTitle'), 'loading-title'),
    element('div', msg, 'loading-text')
  )
  const actions = element('div', '', 'loading-actions')
  if (retryAction) {
    actions.append(button(t('common.retry'), () => { hideLoading(); retryAction() }))
  }
  actions.append(button(t('errors.backToLibrary'), () => { hideLoading(); navigateShelf() }))
  box.append(actions)
  overlay.append(box)
  overlay.style.display = 'flex'
}

function loginPage() {
  document.title = t('auth.signIn')
  app.replaceChildren()
  const form = element('form', '', 'login')
  const user = element('input')
  user.placeholder = t('auth.username')
  user.autocomplete = 'username'
  const pass = element('input')
  pass.type = 'password'
  pass.placeholder = t('auth.password')
  pass.autocomplete = 'current-password'
  const status = element('div', '', 'status')
  form.append(
    element('h1', 'Bookdock'),
    user,
    pass,
    button(t('auth.signIn'), () => void run(async () => {
      status.textContent = t('eink.signingIn')
      try {
        const response = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user.value.trim(), password: pass.value }),
        })
        if (!response.ok) throw new Error(t('auth.errors.invalidCredentials'))
        const me = await (await request('/auth/me')).json()
        accountId = me.data.id
        await renderRoute()
      } catch (error: any) {
        status.textContent = error.message
      }
    })),
    status
  )
  app.append(form)
}

function sizeShelf(): boolean {
  const grid = document.querySelector<HTMLElement>('.shelf .grid')
  const footer = document.querySelector<HTMLElement>('.shelf .shelf-footer')
  if (!grid || !footer) return false
  const availableHeight = footer.getBoundingClientRect().top - grid.getBoundingClientRect().top
  if (grid.clientWidth <= 0 || availableHeight <= 0) return false
  const layout = getShelfLayout(grid.clientWidth, availableHeight)
  grid.style.gridTemplateColumns = `repeat(${layout.columns}, ${layout.coverWidth}px)`
  grid.style.height = `${Math.floor(availableHeight)}px`
  grid.classList.toggle('grid-balanced', grid.children.length > layout.columns)
  if (layout.pageSize === shelfPageSize) return false
  const firstIndex = (shelfPage - 1) * shelfPageSize
  shelfPageSize = layout.pageSize
  shelfPage = Math.floor(firstIndex / shelfPageSize) + 1
  return true
}

function scheduleShelfResize() {
  if (!document.querySelector('.shelf .grid')) return
  if (shelfResizeTimer) clearTimeout(shelfResizeTimer)
  shelfResizeTimer = setTimeout(() => {
    shelfResizeTimer = null
    if (!document.querySelector('.shelf .grid')) return
    if (shelfRendering || busy || routeRendering) {
      scheduleShelfResize()
      return
    }
    if (sizeShelf()) void run(shelf)
  }, 150)
}
window.addEventListener('resize', scheduleShelfResize)

async function shelf() {
  document.title = t('app.name')
  shelfRendering = true
  showLoading(t('eink.loadingShelf'))
  await leaveReader()
  try {
    app.replaceChildren()
    const main = element('main', '', 'shelf')
    const header = element('header', '', 'shelf-header')
    const title = element('h1', t('library.myLibrary'))
    const titleGroup = element('div', '', 'shelf-title-group')
    const headerActions = element('div', '', 'shelf-header-actions')
    const languageBtn = button(getLanguage() === 'en' ? 'EN' : '中', () => {
      setLanguage(getLanguage() === 'en' ? 'zh-CN' : 'en')
      void run(shelf)
    }, 'theme-btn')
    languageBtn.setAttribute('aria-label', `${t('settings.language')}: ${getLanguage() === 'en' ? 'English' : '中文'}`)
    const logoutBtn = button('', () => {
      const overlay = ensureLoadingOverlay()
      overlay.replaceChildren()
      const box = element('div', '', 'loading-box')
      box.setAttribute('role', 'dialog')
      box.setAttribute('aria-modal', 'true')
      box.setAttribute('aria-label', t('eink.signOutConfirm'))
      box.append(element('div', t('eink.signOutConfirm'), 'loading-text'))
      const actions = element('div', '', 'loading-actions')
      actions.append(
        button(t('common.cancel'), hideLoading),
        button(t('auth.signOut'), () => void run(async () => {
          hideLoading()
          try { await fetch('/api/v1/auth/logout', { method: 'POST' }) } catch {}
          accountId = ''
          loginPage()
        })),
      )
      box.append(actions)
      overlay.append(box)
      overlay.style.display = 'flex'
    }, 'logout-btn')
    logoutBtn.setAttribute('aria-label', t('auth.signOut'))
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('viewBox', '0 0 24 24')
    icon.setAttribute('fill', 'none')
    icon.setAttribute('stroke', 'currentColor')
    icon.setAttribute('stroke-width', '2')
    icon.setAttribute('stroke-linecap', 'round')
    icon.setAttribute('stroke-linejoin', 'round')
    icon.setAttribute('aria-hidden', 'true')
    for (const d of ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9']) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', d)
      icon.append(path)
    }
    logoutBtn.append(icon)
    titleGroup.append(title, logoutBtn)
    headerActions.append(languageBtn)
    header.append(titleGroup, headerActions)
    main.append(header)

    const grid = element('div', '', 'grid')
    const footer = element('nav', '', 'shelf-footer')
    const prev = button(t('library.previousPage'), () => void run(async () => { shelfPage--; await shelf() }))
    const next = button(t('library.nextPage'), () => void run(async () => { shelfPage++; await shelf() }))
    const pageLabel = element('span')
    footer.append(prev, pageLabel, next)
    main.append(grid, footer)
    app.append(main)
    sizeShelf()
    const librariesPromise = request('/libraries').then(res => res.json() as Promise<{ data: LibraryListItem[] }>).catch(() => null)
    let result: any
    let libraries: { data: LibraryListItem[] } | null = null
    for (;;) {
      const requestedPage = shelfPage
      const requestedSize = shelfPageSize
      const response = await request(`/books?page=${requestedPage}&pageSize=${requestedSize}&sortBy=lastReadAt&sortOrder=desc`)
      result = await response.json()
      libraries = await librariesPromise
      if (!main.isConnected) return
      sizeShelf()
      const lastPage = Math.max(1, Math.ceil(result.total / shelfPageSize))
      shelfPage = Math.min(shelfPage, lastPage)
      if (requestedPage === shelfPage && requestedSize === shelfPageSize) break
    }
    title.textContent = libraries ? libraries.data.find(item => item.type === 'private')?.name || t('library.myLibrary') : '—'
    for (const item of result.data) {
      const card = button('', () => navigateBook(item.id), 'book')
      const cover = element('div', '', 'cover')
      const fallback = element('div', '', 'cover-fallback')
      const name = item.title.trim().replace(/\.(epub|txt|pdf|mobi|azw3?|fb2)$/i, '') || item.title.trim()
      fallback.append(element('span', name, 'cover-fallback-title'))
      cover.append(fallback)
      if (item.coverKey || item.format === 'epub') {
        const image = element('img')
        image.alt = item.title
        image.onload = () => { fallback.hidden = true }
        image.onerror = () => { image.hidden = true; fallback.hidden = false }
        image.src = `/api/v1/books/${encodeURIComponent(item.id)}/cover?size=thumb&v=${encodeURIComponent(item.coverKey || 'auto')}`
        cover.append(image)
      }
      card.append(cover, element('span', item.title, 'book-title'))
      grid.append(card)
    }
    sizeShelf()
    prev.disabled = shelfPage <= 1
    next.disabled = shelfPage * shelfPageSize >= result.total
    pageLabel.textContent = t('eink.page', { page: shelfPage })
    hideLoading()
  } catch (error) {
    showError(error, shelf)
  } finally { shelfRendering = false }
}

function readerPage() {
  app.replaceChildren()
  const host = element('div', '', 'reader')
  const backdrop = element('div', '', 'backdrop')
  backdrop.hidden = true
  const panel = element('aside', '', 'panel')
  panel.hidden = true
  let tocResize: (() => void) | null = null

  const closePanel = () => {
    if (tocResize) window.removeEventListener('resize', tocResize)
    tocResize = null
    backdrop.hidden = true
    backdrop.className = 'backdrop'
    panel.hidden = true
    panel.className = 'panel'
    panel.replaceChildren()
  }
  closeReaderPanel = closePanel
  backdrop.onclick = closePanel

  const openPanel = (title: string, subtitle = '') => {
    if (tocResize) window.removeEventListener('resize', tocResize)
    tocResize = null
    panel.className = 'panel'
    backdrop.className = 'backdrop'
    panel.replaceChildren()
    const header = element('header')
    const headerTitle = element('h2', title)
    header.append(headerTitle)
    if (subtitle) {
      const subtitleEl = element('span', subtitle, 'panel-header-subtitle')
      header.append(subtitleEl)
    }
    const body = element('div', '', 'panel-body')
    panel.append(header, body)
    backdrop.hidden = false
    panel.hidden = false
    return body
  }

  const openSettingsPanel = () => {
    if (tocResize) window.removeEventListener('resize', tocResize)
    tocResize = null
    panel.replaceChildren()
    panel.className = 'panel panel-bottom'
    backdrop.className = 'backdrop backdrop-transparent'
    backdrop.hidden = false
    panel.hidden = false
    return panel
  }

  const controls = element('nav', '', 'controls')
  const turnStatus = element('div', '', 'turn-status')
  turnStatus.hidden = true
  turnStatus.setAttribute('role', 'status')
  let queuedTurn: -1 | 1 | null = null
  let turning = false
  const turn = async (direction: -1 | 1) => {
    if (turning) { queuedTurn = direction; return }
    if (busy || !view) return
    const readerView = view
    turning = true
    busy = true
    try {
      let next: -1 | 1 | null = direction
      while (next !== null && view === readerView) {
        const current: -1 | 1 = next
        queuedTurn = null
        if (current === 1 ? readerView.renderer?.atEnd : readerView.renderer?.atStart) {
          turnStatus.hidden = false
          turnStatus.textContent = t(current === 1 ? 'eink.atEnd' : 'eink.atStart')
          await new Promise(resolve => setTimeout(resolve, 1000))
        } else {
          trackingPosition = true
          const timer = setTimeout(() => {
            turnStatus.textContent = t(current === 1 ? 'eink.turningNext' : 'eink.turningPrevious')
            turnStatus.hidden = false
          }, 350)
          try { await (current === 1 ? readerView.next() : readerView.prev()) }
          finally { clearTimeout(timer); turnStatus.hidden = true }
        }
        next = queuedTurn
      }
    } catch (error) {
      queuedTurn = null
      if (view === readerView) showError(error, () => { void turn(direction) })
    } finally {
      turnStatus.hidden = true
      turning = false
      busy = false
    }
  }
  controls.append(
    button(t('library.title'), () => { closePanel(); navigateShelf() }),
    button(t('settings.title'), () => {
      const panelEl = openSettingsPanel()
      let currentTab: 'font' | 'layout' | 'other' = activeSettingsTab

      const header = element('div', '', 'settings-header')
      const tabsWrap = element('div', '', 'settings-tabs')
      const fontTabBtn = element('button', t('eink.tabFont'), currentTab === 'font' ? 'settings-tab-btn active' : 'settings-tab-btn')
      const layoutTabBtn = element('button', t('eink.tabLayout'), currentTab === 'layout' ? 'settings-tab-btn active' : 'settings-tab-btn')
      const otherTabBtn = element('button', t('eink.tabOther'), currentTab === 'other' ? 'settings-tab-btn active' : 'settings-tab-btn')
      tabsWrap.append(fontTabBtn, layoutTabBtn, otherTabBtn)

      const sunIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
      const moonIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`

      const actionsWrap = element('div', '', 'settings-header-actions')
      const themeGroup = element('div', '', 'theme-segmented-group')
      const lightBtn = element('button', '', getActiveTheme() === 'light' ? 'theme-segmented-btn active' : 'theme-segmented-btn')
      lightBtn.innerHTML = sunIconSvg
      lightBtn.setAttribute('aria-label', t('theme.light'))
      const darkBtn = element('button', '', getActiveTheme() === 'dark' ? 'theme-segmented-btn active' : 'theme-segmented-btn')
      darkBtn.innerHTML = moonIconSvg
      darkBtn.setAttribute('aria-label', t('theme.dark'))
      lightBtn.onclick = () => {
        if (getActiveTheme() === 'light') return
        applyTheme('light')
        lightBtn.className = 'theme-segmented-btn active'
        darkBtn.className = 'theme-segmented-btn'
        setStyles()
      }
      darkBtn.onclick = () => {
        if (getActiveTheme() === 'dark') return
        applyTheme('dark')
        darkBtn.className = 'theme-segmented-btn active'
        lightBtn.className = 'theme-segmented-btn'
        setStyles()
      }
      themeGroup.append(lightBtn, darkBtn)
      actionsWrap.append(themeGroup)
      header.append(tabsWrap, actionsWrap)

      const body = element('div', '', 'panel-body')
      panelEl.append(header, body)

      const createStepper = (label: string, min: number, max: number, getVal: () => number, onStep: (next: number) => void) => {
        const row = element('div', '', 'stepper-row')
        const lbl = element('span', label, 'stepper-label')
        const controls = element('div', '', 'stepper-controls')
        const minusBtn = element('button', '－', 'stepper-btn')
        const plusBtn = element('button', '＋', 'stepper-btn')
        const trackWrap = element('div', '', 'stepper-track-wrap')
        const trackBg = element('div', '', 'stepper-track-bg')
        const trackFill = element('div', '', 'stepper-track-fill')
        const thumb = element('div', '', 'stepper-thumb')
        const thumbVal = element('span', String(getVal()), 'stepper-thumb-val')
        thumb.append(thumbVal)
        trackWrap.append(trackBg, trackFill, thumb)

        const updateTrack = () => {
          const val = getVal()
          thumbVal.textContent = String(val)
          const ratio = max === min ? 0 : (val - min) / (max - min)
          trackFill.style.width = `calc((100% - 24px) * ${ratio})`
          thumb.style.left = `calc(12px + (100% - 24px) * ${ratio})`
        }
        updateTrack()

        const applyFromPosition = (clientX: number) => {
          if (busy) return
          const rect = trackWrap.getBoundingClientRect()
          const innerLeft = rect.left + 12
          const innerWidth = rect.width - 24
          if (innerWidth <= 0) return
          const ratio = Math.max(0, Math.min(1, (clientX - innerLeft) / innerWidth))
          const targetStep = Math.round(min + ratio * (max - min))
          if (targetStep !== getVal()) {
            onStep(targetStep)
            updateTrack()
          }
        }

        trackWrap.onclick = (e: MouseEvent) => {
          applyFromPosition(e.clientX)
        }

        let isDragging = false
        trackWrap.onpointerdown = (e: PointerEvent) => {
          isDragging = true
          try { (trackWrap as any).setPointerCapture?.(e.pointerId) } catch {}
          applyFromPosition(e.clientX)
        }
        trackWrap.onpointermove = (e: PointerEvent) => {
          if (isDragging) {
            applyFromPosition(e.clientX)
          }
        }
        const stopDrag = (e: PointerEvent) => {
          if (isDragging) {
            isDragging = false
            try { (trackWrap as any).releasePointerCapture?.(e.pointerId) } catch {}
          }
        }
        trackWrap.onpointerup = stopDrag
        trackWrap.onpointercancel = stopDrag

        minusBtn.onclick = () => {
          if (busy) return
          const cur = getVal()
          if (cur > min) {
            onStep(cur - 1)
            updateTrack()
          }
        }
        plusBtn.onclick = () => {
          if (busy) return
          const cur = getVal()
          if (cur < max) {
            onStep(cur + 1)
            updateTrack()
          }
        }

        controls.append(minusBtn, trackWrap, plusBtn)
        row.append(lbl, controls)
        return row
      }

      const renderFontTab = () => {
        body.className = 'panel-body'
        body.replaceChildren()

        const fontRow = element('div', '', 'font-family-row')
        for (const font of FONTS) {
          const item = element('div', '', font.id === activeFont ? 'font-radio-item active' : 'font-radio-item')
          const circle = element('span', '', 'font-radio-circle')
          const text = element('span', t(font.labelKey))
          item.append(circle, text)
          item.style.fontFamily = font.family
          item.onclick = () => {
            if (busy || font.id === activeFont) return
            const anchor = currentCfi
            setFont(font.id)
            for (const child of Array.from(fontRow.children)) (child as HTMLElement).className = 'font-radio-item'
            item.className = 'font-radio-item active'
            void run(async () => {
              setStyles()
              if (anchor) await view.goTo(anchor)
            })
          }
          fontRow.append(item)
        }
        body.append(fontRow)

        const boldnessStepper = createStepper(t('eink.boldness'), 0, BOLDNESS_STROKES.length - 1, () => boldnessStep, (next) => {
          const anchor = currentCfi
          setBoldness(next)
          void run(async () => {
            setStyles()
            if (anchor) await view.goTo(anchor)
          })
        })
        body.append(boldnessStepper)

        const sizeStepper = createStepper(t('eink.fontSize'), 1, FONT_SIZES.length, () => fontSizeStep, (next) => {
          const anchor = currentCfi
          setFontSizeStep(next)
          void run(async () => {
            setStyles()
            if (anchor) await view.goTo(anchor)
          })
        })
        body.append(sizeStepper)
      }

      const renderLayoutTab = () => {
        body.className = 'panel-body'
        body.replaceChildren()

        const optionsRow = element('div', '', 'layout-options-row')

        const marginGroup = element('div', '', 'layout-opt-group')
        marginGroup.append(element('div', t('eink.margins'), 'layout-opt-title'))
        const marginCards = element('div', '', 'layout-opt-cards')
        const marginSvgLines = [
          '<line x1="4" y1="4" x2="40" y2="4"/><line x1="4" y1="12" x2="40" y2="12"/><line x1="4" y1="20" x2="40" y2="20"/>',
          '<line x1="9" y1="4" x2="35" y2="4"/><line x1="9" y1="12" x2="35" y2="12"/><line x1="9" y1="20" x2="35" y2="20"/>',
          '<line x1="15" y1="4" x2="29" y2="4"/><line x1="15" y1="12" x2="29" y2="12"/><line x1="15" y1="20" x2="29" y2="20"/>',
        ]
        marginSvgLines.forEach((svgLine, idx) => {
          const card = element('div', '', idx === marginStep ? 'layout-card active' : 'layout-card')
          card.innerHTML = `<svg width="44" height="24" viewBox="0 0 44 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${svgLine}</svg>`
          card.onclick = () => {
            if (busy || idx === marginStep) return
            const anchor = currentCfi
            setMarginStep(idx)
            for (const c of Array.from(marginCards.children)) (c as HTMLElement).className = 'layout-card'
            card.className = 'layout-card active'
            void run(async () => {
              applyPaginatorMargin()
              setStyles()
              if (anchor) await view.goTo(anchor)
            })
          }
          marginCards.append(card)
        })
        marginGroup.append(marginCards)

        const alignGroup = element('div', '', 'layout-opt-group')
        alignGroup.append(element('div', t('eink.alignment'), 'layout-opt-title'))
        const alignCards = element('div', '', 'layout-opt-cards')
        const alignItems: Array<{ id: 'justify' | 'left'; svg: string }> = [
          {
            id: 'justify',
            svg: '<line x1="4" y1="4" x2="40" y2="4"/><line x1="4" y1="12" x2="40" y2="12"/><line x1="4" y1="20" x2="40" y2="20"/>',
          },
          {
            id: 'left',
            svg: '<line x1="4" y1="4" x2="40" y2="4"/><line x1="4" y1="12" x2="24" y2="12"/><line x1="4" y1="20" x2="32" y2="20"/>',
          },
        ]
        alignItems.forEach((item) => {
          const card = element('div', '', item.id === activeAlign ? 'layout-card active' : 'layout-card')
          card.innerHTML = `<svg width="44" height="24" viewBox="0 0 44 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${item.svg}</svg>`
          card.onclick = () => {
            if (busy || item.id === activeAlign) return
            const anchor = currentCfi
            setAlign(item.id)
            for (const c of Array.from(alignCards.children)) (c as HTMLElement).className = 'layout-card'
            card.className = 'layout-card active'
            void run(async () => {
              setStyles()
              if (anchor) await view.goTo(anchor)
            })
          }
          alignCards.append(card)
        })
        alignGroup.append(alignCards)

        optionsRow.append(marginGroup, alignGroup)
        body.append(optionsRow)

        const lineStepper = createStepper(t('eink.lineSpacing'), 0, LINE_HEIGHTS.length - 1, () => lineHeightStep, (next) => {
          const anchor = currentCfi
          setLineHeightStep(next)
          void run(async () => {
            setStyles()
            if (anchor) await view.goTo(anchor)
          })
        })
        body.append(lineStepper)

        const paraStepper = createStepper(t('eink.paragraphSpacing'), 0, PARAGRAPH_SPACINGS.length - 1, () => paragraphSpacingStep, (next) => {
          const anchor = currentCfi
          setParagraphSpacingStep(next)
          void run(async () => {
            setStyles()
            if (anchor) await view.goTo(anchor)
          })
        })
        body.append(paraStepper)

        const letterStepper = createStepper(t('eink.letterSpacing'), 0, LETTER_SPACINGS.length - 1, () => letterSpacingStep, (next) => {
          const anchor = currentCfi
          setLetterSpacingStep(next)
          void run(async () => {
            setStyles()
            if (anchor) await view.goTo(anchor)
          })
        })
        body.append(letterStepper)
      }

      const renderOtherTab = () => {
        body.className = 'panel-body other-settings'
        body.replaceChildren()
        const group = element('div', '', 'turn-area-group')
        group.append(element('div', t('eink.turnArea'), 'turn-area-title'))
        const cards = element('div', '', 'turn-area-cards')
        const modes = [
          { id: 'standard', label: 'eink.turnStandard', left: '←', right: '→' },
          { id: 'single', label: 'eink.turnSingle', left: '→', right: '→' },
          { id: 'disabled', label: 'eink.turnDisabled', left: '–', right: '–' },
        ] as const
        for (const mode of modes) {
          const option = element('div', '', 'turn-area-option')
          const card = element('button', '', 'layout-card turn-area-card') as HTMLButtonElement
          card.type = 'button'
          card.setAttribute('aria-pressed', String(turnArea === mode.id))
          card.setAttribute('aria-label', t(mode.label))
          const diagram = element('span', '', 'turn-area-diagram')
          diagram.setAttribute('aria-hidden', 'true')
          diagram.append(element('span', mode.left), element('span', mode.right))
          card.append(diagram)
          option.append(card)
          card.onclick = () => {
            turnArea = mode.id
            try { localStorage.setItem(TURN_AREA_KEY, turnArea) } catch {}
            for (const child of Array.from(cards.querySelectorAll('button'))) child.setAttribute('aria-pressed', String(child === card))
          }
          cards.append(option)
        }
        group.append(cards)
        body.append(group)
        if (!cleanReadingSupported) return
        const row = element('div', '', 'other-setting-row')
        const label = element('span', t('reader.cleanReading'))
        const toggle = button('', () => {
          if (busy) return
          const target = { cfi: currentCfi, revisionId: manifest?.revisionId }
          cleanReading = !cleanReading
          try { localStorage.setItem(CLEAN_READING_KEY, String(cleanReading)) } catch {}
          toggle.setAttribute('aria-checked', String(cleanReading))
          panel.setAttribute('aria-busy', 'true')
          void run(async () => {
            try { await openBook(currentBookId, target, true) }
            finally { panel.removeAttribute('aria-busy') }
          })
        }, 'other-setting-toggle')
        toggle.setAttribute('role', 'switch')
        toggle.setAttribute('aria-label', t('reader.cleanReading'))
        toggle.setAttribute('aria-checked', String(cleanReading))
        row.append(label, toggle)
        body.append(row)
      }

      fontTabBtn.onclick = () => {
        if (currentTab === 'font') return
        currentTab = 'font'
        setSettingsTab('font')
        fontTabBtn.className = 'settings-tab-btn active'
        layoutTabBtn.className = 'settings-tab-btn'
        otherTabBtn.className = 'settings-tab-btn'
        renderFontTab()
      }
      layoutTabBtn.onclick = () => {
        if (currentTab === 'layout') return
        currentTab = 'layout'
        setSettingsTab('layout')
        layoutTabBtn.className = 'settings-tab-btn active'
        fontTabBtn.className = 'settings-tab-btn'
        otherTabBtn.className = 'settings-tab-btn'
        renderLayoutTab()
      }

      otherTabBtn.onclick = () => {
        if (currentTab === 'other') return
        currentTab = 'other'
        setSettingsTab('other')
        otherTabBtn.className = 'settings-tab-btn active'
        fontTabBtn.className = 'settings-tab-btn'
        layoutTabBtn.className = 'settings-tab-btn'
        renderOtherTab()
      }

      if (currentTab === 'layout') {
        renderLayoutTab()
      } else if (currentTab === 'other') {
        renderOtherTab()
      } else {
        renderFontTab()
      }
    }),
    button(t('reader.toc'), () => {
      const rows: Array<{ item: any; depth: number }> = []
      const visit = (items: any[], depth: number) => {
        for (const item of items || []) {
          rows.push({ item, depth })
          visit(item.subitems, depth + 1)
        }
      }
      visit(book.toc, 0)
      const body = openPanel(t('reader.toc'), t('eink.chapterCount', { count: rows.length }))

      let activeIndex = currentHref ? rows.findIndex(row => row.item.href === currentHref) : -1
      const label = currentTocLabel.trim()
      if (activeIndex < 0 && label) {
        activeIndex = rows.findIndex(row => (row.item.label || '').trim() === label)
        if (activeIndex < 0) activeIndex = rows.findIndex(row => {
          const candidate = (row.item.label || '').trim()
          return candidate && (candidate.includes(label) || label.includes(candidate))
        })
      }

      const list = element('div', '', 'toc-list')
      const footer = element('div', '', 'panel-footer')
      const pager = element('div', '', 'toc-pager')
      body.append(list)
      footer.append(pager)
      panel.append(footer)

      const measurePageSize = () => {
        footer.hidden = true
        const singlePageSize = Math.max(1, Math.floor(body.clientHeight / 48))
        if (rows.length <= singlePageSize) return singlePageSize
        footer.hidden = false
        return Math.max(1, Math.floor(body.clientHeight / 48))
      }
      let pageSize = measurePageSize()
      let totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
      let page = activeIndex >= 0 ? Math.floor(activeIndex / pageSize) : 0

      const draw = () => {
        list.replaceChildren()
        pager.replaceChildren()

        const start = page * pageSize
        const end = Math.min(rows.length, start + pageSize)
        list.classList.toggle('toc-list-fill', page < totalPages - 1)
        for (let i = start; i < end; i++) {
          const { item, depth } = rows[i]
          const isCurrent = activeIndex === i
          const rowClass = isCurrent ? 'toc-row current' : 'toc-row'
          const row = button('', () => {
            closePanel()
            void run(async () => {
              nextPrefetch?.cancel()
              preparedSection?.cancel()
              trackingPosition = true
              await view.goTo(item.href)
            })
          }, rowClass)
          const textSpan = element('span', item.label || t('eink.unnamedChapter'))
          const indent = Math.min(depth * 14, 42)
          row.style.paddingLeft = `${12 + indent}px`
          row.append(textSpan)
          list.append(row)
        }

        if (totalPages > 1) {
          const previous = button(t('library.previousPage'), () => { page--; draw() })
          previous.disabled = page <= 0
          const next = button(t('library.nextPage'), () => { page++; draw() })
          next.disabled = page >= totalPages - 1
          pager.append(previous, element('span', `${page + 1} / ${totalPages}`), next)
          footer.replaceChildren(pager)
          footer.hidden = false
        } else {
          footer.hidden = true
        }
      }

      draw()
      tocResize = () => {
        const firstIndex = page * pageSize
        pageSize = measurePageSize()
        totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
        page = Math.min(totalPages - 1, Math.floor(firstIndex / pageSize))
        draw()
      }
      window.addEventListener('resize', tocResize)
    }),
    button(t('library.previousPage'), () => void turn(-1)),
    button(t('library.nextPage'), () => void turn(1)),
  )
  app.append(host, backdrop, panel, controls, turnStatus)
  replaceReaderView = () => {
    view = element('foliate-view') as any
    host.replaceChildren(view)
    view.addEventListener('load', (event: any) => {
      if (!cleanReading || !cleanReadingSupported) return
      const { doc, index } = event.detail ?? {}
      const label = view?.getProgressOf?.(index)?.tocItem?.label
      if (doc && typeof label === 'string') markEpubChapterTitle(doc, label)
    })
    view.addEventListener('relocate', (event: any) => {
      currentCfi = event.detail.cfi || currentCfi
      currentHref = event.detail.tocItem?.href || ''
      currentTocLabel = event.detail.tocItem?.label || ''
      if (trackingPosition && !ignoreRelocate && currentCfi && manifest) {
        const fraction = Math.max(0, Math.min(1, Number(event.detail.fraction) || 0))
        queueProgress({
          revisionId: manifest.revisionId,
          cfi: currentCfi,
          contentCfi: currentCfi,
          percent: fraction * 100,
          fraction,
        })
      }
      nextPrefetch?.schedule(event.detail?.section?.current)
      preparedSection?.schedule(event.detail?.section?.current)
    })
    view.addEventListener('click-view', (event: any) => {
      if (!panel.hidden || (busy && !turning)) return
      const bounds = view.getBoundingClientRect()
      const x = (event.detail.x - bounds.left) / bounds.width
      if (turnArea === 'disabled' || x < 0 || x > 1) return
      void turn(turnArea === 'single' || x >= 0.5 ? 1 : -1)
    })
  }
  replaceReaderView()
}

function applyPaginatorMargin() {
  if (!view?.renderer) return
  const currentMarginPx = MARGINS[marginStep]
  view.renderer.setAttribute('gutter', `${currentMarginPx}px`)
  view.renderer.setAttribute('margin-left', `${currentMarginPx}px`)
  view.renderer.setAttribute('margin-right', `${currentMarginPx}px`)
  view.renderer.setAttribute('gap', '3%')
  if (view.renderer.shadowRoot) {
    let css = view.renderer.shadowRoot.querySelector('#eink-layout-style') as HTMLStyleElement | null
    if (!css) {
      css = element('style')
      css.id = 'eink-layout-style'
      view.renderer.shadowRoot.append(css)
    }
    css.textContent = `#top { --_gap: 3% !important; --_gutter: ${currentMarginPx}px !important; --_margin-left: ${currentMarginPx}px !important; --_margin-right: ${currentMarginPx}px !important; grid-template-rows: 12px minmax(0, 1fr) 12px !important; } #header, #footer { height: 12px !important; }`
  }
  view.renderer.render?.()
}

function setStyles() {
  const isDark = getActiveTheme() === 'dark'
  const bg = isDark ? '#000000' : '#ffffff'
  const fg = isDark ? '#ffffff' : '#000000'
  const fontObj = FONTS.find(f => f.id === activeFont) || FONTS[0]
  const currentFontSize = FONT_SIZES[fontSizeStep - 1]
  const stroke = BOLDNESS_STROKES[boldnessStep]
  const currentLineHeight = LINE_HEIGHTS[lineHeightStep]
  const currentParaSpacing = PARAGRAPH_SPACINGS[paragraphSpacingStep]
  const currentLetterSpacing = LETTER_SPACINGS[letterSpacingStep]
  const align = activeAlign
  const textJustify = align === 'justify' ? 'inter-ideograph' : 'auto'
  const strokeCss = boldnessStep > 0 ? `-webkit-text-stroke: ${stroke} ${fg} !important;` : '-webkit-text-stroke: 0 !important;'

  applyPaginatorMargin()

  view.renderer.style.setProperty('background-color', bg)
  view.renderer.setAttribute('background-color', bg)
  view.renderer.setStyles(`
    html, body {
      font-family: ${fontObj.family} !important;
      font-size: ${currentFontSize}px !important;
      line-height: ${currentLineHeight} !important;
      letter-spacing: ${currentLetterSpacing} !important;
      background: ${bg} !important;
      color: ${fg} !important;
      text-align: ${align} !important;
      text-justify: ${textJustify} !important;
      word-break: break-word !important;
      ${strokeCss}
    }
    body {
      padding: 0 !important;
      margin: 0 !important;
    }
    p, div, span, a, li, blockquote {
      font-family: ${fontObj.family} !important;
      text-align: ${align} !important;
      text-justify: ${textJustify} !important;
      word-break: break-word !important;
      letter-spacing: ${currentLetterSpacing} !important;
      ${strokeCss}
    }
    p, li, blockquote {
      font-size: ${currentFontSize}px !important;
      line-height: ${currentLineHeight} !important;
    }
    p {
      margin-top: 0 !important;
      margin-bottom: ${currentParaSpacing} !important;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: ${fontObj.family} !important;
      ${strokeCss}
    }
    pre, code, kbd, .code {
      font-family: monospace !important;
      text-align: left !important;
      white-space: pre-wrap !important;
      -webkit-text-stroke: 0 !important;
    }
    img {
      max-width: 100% !important;
      height: auto !important;
    }
    ${cleanReading && cleanReadingSupported ? `
      body * { color: inherit !important; background: transparent !important; box-shadow: none !important; text-shadow: none !important; }
      [data-bd-clean-hidden] { display: none !important; }
      p, div, span, a, li, blockquote { font-size: inherit !important; line-height: ${currentLineHeight} !important; }
      p { text-indent: 2em !important; }
      [data-bd-chapter-title] { text-align: center !important; text-indent: 0 !important; }
      [data-bd-chapter-title] * { text-align: inherit !important; }
      a:any-link { text-decoration: underline; }
    ` : ''}
  `)
}

async function openBook(id: string, previousPosition?: { cfi: string; revisionId?: string }, keepPanel = false) {
  document.title = t('reader.loading')
  await leaveReader(keepPanel)
  currentBookId = id
  cleanReadingSupported = false
  currentCfi = ''
  currentHref = ''
  currentTocLabel = ''
  trackingPosition = false
  if (keepPanel && replaceReaderView) replaceReaderView()
  else {
    showLoading(t('eink.openingBook'))
    readerPage()
  }
  const readerView = view
  let imageFailed = false
  try {
    const [manifestResponse, progressResponse] = await Promise.all([
      request(`/books/${id}/reader/manifest`),
      request(`/progress/${id}?expectedUserId=${encodeURIComponent(accountId)}`)
    ])
    const readerManifest = (await manifestResponse.json()).data
    manifest = readerManifest
    cleanReadingSupported = !readerManifest.generated
    const clean = cleanReadingSupported && cleanReading
    const progress = (await progressResponse.json()).data
    progressQueue = initProgressSync(id, accountId)
    const entries = new Map(readerManifest.entries.map((entry: any) => [entry.path, entry]))
    const startup = new Map(readerManifest.startupFiles.map((file: any) => [file.path, file.text]))
    const textCache = createTextCache()
    const imageCache = createImageCache()
    const loadText = async (name: string, signal?: AbortSignal) => {
      const cached = textCache.get(name)
      if (cached !== undefined) return cached
      const prefetched = nextPrefetch?.waitFor(name, signal)
      if (prefetched) {
        const text = await prefetched
        if (signal?.aborted) throw new DOMException('Navigation aborted', 'AbortError')
        if (typeof text === 'string') return text
      }
      const entry: any = entries.get(name)
      if (!entry) return null
      let text: string
      if (startup.has(name)) text = startup.get(name) as string
      else {
        const response = await request(`/books/${id}/reader/entry?revisionId=${encodeURIComponent(readerManifest.revisionId)}&path=${encodeURIComponent(name)}&includeResourceDimensions=false`, { signal })
        text = entry.mediaType === 'application/xhtml+xml' ? (await response.json()).data.text : await response.text()
      }
      text = filterEinkMedia(text, entry.mediaType)
      if (clean && /^(application\/xhtml\+xml|text\/html)$/i.test(entry.mediaType)) text = sanitizeCleanReadingMarkup(text, entry.mediaType)
      if (signal?.aborted) return null
      textCache.set(name, text)
      return text
    }
    const loadBlob = async (name: string, _type?: string, signal?: AbortSignal) => {
      if (!entries.has(name)) return null
      const entry: any = entries.get(name)
      if (isEinkMedia(entry.mediaType || _type || '', name)) return null
      if (clean && shouldSkipCleanReadingResource(entry.mediaType || _type || '', name)) return null
      const variant = /^image\/(jpeg|png|webp|gif)$/i.test(entry.mediaType) ? '&imageVariant=eink' : ''
      const cachedImage = variant ? imageCache.get(name) : undefined
      if (cachedImage) return cachedImage
      try {
        const response = await request(`/books/${id}/reader/entry?revisionId=${encodeURIComponent(readerManifest.revisionId)}&path=${encodeURIComponent(name)}${variant}`, { signal })
        const blob = await response.blob()
        if (variant && !signal?.aborted) imageCache.set(name, blob)
        return blob
      } catch (error) {
        if (variant && !signal?.aborted && readerView === view) {
          imageFailed = true
          showError(error, () => { void run(() => openBook(id)) })
        }
        throw error
      }
    }
    book = await new EPUB({
      entries: readerManifest.entries.map((entry: any) => ({ filename: entry.path, uncompressedSize: entry.size, compressedSize: entry.compressedSize })),
      loadText, loadBlob, getSize: (name: string) => (entries.get(name) as any)?.size || 0,
    } as any).init()
    if (book.rendition?.layout === 'pre-paginated') throw new Error(t('eink.fixedLayoutUnsupported'))
    if (clean) book.transformTarget?.addEventListener('load', (event: any) => {
      if (shouldSkipCleanReadingResource(event.detail?.type, event.detail?.href)) {
        event.detail.allow = true
        event.detail.url = 'data:text/plain,'
      }
    })
    nextPrefetch = createNextSectionPrefetch(book.sections, (name, signal) => {
      const entry: any = entries.get(name)
      if (!entry || !/^(application\/xhtml\+xml|text\/html)$/i.test(entry.mediaType)) return Promise.resolve(null)
      return loadText(name, signal)
    })
    if (clean || readerManifest.generated) {
      preparedSection = prepareNextSection(book.sections, name => {
        const entry: any = entries.get(name)
        return !!entry && typeof entry.size === 'number' && entry.size > 0 && entry.size <= 256 * 1024
      })
    }
    await view.open(book)
    view.renderer.setAttribute('flow', 'paginated')
    view.renderer.setAttribute('eink', '')
    view.renderer.setAttribute('max-column-count', '1')
    view.renderer.setAttribute('max-inline-size', '100000')
    applyPaginatorMargin()
    setStyles()
    const position = previousPosition?.cfi && previousPosition.revisionId === readerManifest.revisionId
      ? { cfi: previousPosition.cfi, percent: 0 } : progress
    await restoreProgress(view, position, book.sections.length)
    if (!imageFailed && !keepPanel) hideLoading()
    if (!imageFailed) {
      const titleRouteVersion = routeVersion
      const titleErrorAtRequest = titleErrorVersion
      void request(`/books/${encodeURIComponent(id)}`).then(response => response.json()).then(result => {
        if (titleRouteVersion === routeVersion && titleErrorAtRequest === titleErrorVersion && readerView === view) document.title = typeof result.data?.title === 'string' && result.data.title.trim() ? result.data.title : t('app.name')
      }).catch(() => {
        if (titleRouteVersion === routeVersion && titleErrorAtRequest === titleErrorVersion && readerView === view) document.title = t('app.name')
      })
    }
  } catch (error) {
    showError(error, () => openBook(id, previousPosition, keepPanel))
  }
}

async function start() {
  try {
    const me = await (await request('/auth/me')).json()
    if (me.data && !me.data.guest) { accountId = me.data.id; await renderRoute() }
    else { hideLoading(); loginPage() }
  } catch {
    hideLoading()
    loginPage()
  }
}

function navigateBook(id: string) {
  const target = `#/book/${encodeURIComponent(id)}`
  if (location.hash === target) void renderRoute()
  else location.hash = target
}

function navigateShelf() {
  if (location.hash) location.hash = ''
  else void renderRoute()
}

let routeVersion = 0
let routeRendering = false
async function renderRoute() {
  routeVersion++
  if (routeRendering || !accountId) return
  routeRendering = true
  try {
    let renderedVersion: number
    do {
      renderedVersion = routeVersion
      const hash = location.hash
      const match = /^#\/book\/([^/]+)$/.exec(hash)
      if (!hash || hash === '#') await shelf()
      else if (match) {
        try { await openBook(decodeURIComponent(match[1])) }
        catch { showError(new Error(t('eink.unknownError'))) }
      } else showError(new Error(t('eink.unknownError')))
    } while (renderedVersion !== routeVersion)
  } finally { routeRendering = false }
}

window.addEventListener('hashchange', () => { void renderRoute() })

window.addEventListener('beforeunload', () => {
  nextPrefetch?.dispose()
  preparedSection?.dispose()
  if (progressQueue) void progressQueue.flush()
})

void start()
