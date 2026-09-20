import * as CFI from './epubcfi.js'
import { TOCProgress, SectionProgress, PageProgress } from './progress.js'
import { Overlayer } from './overlayer.js'
import { textWalker } from './text-walker.js'

const SEARCH_PREFIX = 'foliate-search:'
const SEARCH_ACTIVE_PREFIX = 'foliate-search-active:'

const NOTE_PREFIX = 'foliate-note:'

const isZip = async file => {
    const arr = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    return arr[0] === 0x50 && arr[1] === 0x4b && arr[2] === 0x03 && arr[3] === 0x04
}

const isPDF = async file => {
    const arr = new Uint8Array(await file.slice(0, 5).arrayBuffer())
    return arr[0] === 0x25
        && arr[1] === 0x50 && arr[2] === 0x44 && arr[3] === 0x46
        && arr[4] === 0x2d
}

const isCBZ = ({ name, type }) =>
    type === 'application/vnd.comicbook+zip' || name.endsWith('.cbz')

const isFB2 = ({ name, type }) =>
    type === 'application/x-fictionbook+xml' || name.endsWith('.fb2')

const isFBZ = ({ name, type }) =>
    type === 'application/x-zip-compressed-fb2'
    || name.endsWith('.fb2.zip') || name.endsWith('.fbz')

const makeZipLoader = async file => {
    const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } =
        await import('./vendor/zip.js')
    configure({ useWebWorkers: false })
    const reader = new ZipReader(new BlobReader(file))
    const entries = await reader.getEntries()
    const map = new Map(entries.map(entry => [entry.filename, entry]))
    const insensitive = new Map()
    for (const entry of entries) {
        const key = entry.filename.toLowerCase()
        if (!insensitive.has(key)) insensitive.set(key, entry)
        else if (insensitive.get(key) !== entry) insensitive.set(key, null)
    }
    const find = name => map.get(name) ?? insensitive.get(name.toLowerCase())
    const load = f => (name, ...args) =>
        find(name) ? f(find(name), ...args) : null
    const loadText = load(entry => entry.getData(new TextWriter()))
    const loadBlob = load((entry, type) => entry.getData(new BlobWriter(type)))
    const getSize = name => find(name)?.uncompressedSize ?? 0
    return { entries, loadText, loadBlob, getSize }
}

const getFileEntries = async entry => entry.isFile ? entry
    : (await Promise.all(Array.from(
        await new Promise((resolve, reject) => entry.createReader()
            .readEntries(entries => resolve(entries), error => reject(error))),
        getFileEntries))).flat()

const makeDirectoryLoader = async entry => {
    const entries = await getFileEntries(entry)
    const files = await Promise.all(
        entries.map(entry => new Promise((resolve, reject) =>
            entry.file(file => resolve([file, entry.fullPath]),
                error => reject(error)))))
    const map = new Map(files.map(([file, path]) =>
        [path.replace(entry.fullPath + '/', ''), file]))
    const decoder = new TextDecoder()
    const decode = x => x ? decoder.decode(x) : null
    const getBuffer = name => map.get(name)?.arrayBuffer() ?? null
    const loadText = async name => decode(await getBuffer(name))
    const loadBlob = name => map.get(name)
    const getSize = name => map.get(name)?.size ?? 0
    return { loadText, loadBlob, getSize }
}

export class ResponseError extends Error {}
export class NotFoundError extends Error {}
export class UnsupportedTypeError extends Error {}

// Annotation hits are handled by the overlay click listener. They must not
// also become generic reader-area clicks, otherwise one click opens the
// annotation UI and toggles the reading chrome at the same time.
export function isInteractiveAnnotationHit(overlayer, point) {
    const [value] = overlayer?.hitTest?.(point) ?? []
    return typeof value === 'string' && !value.startsWith(SEARCH_PREFIX) && !value.startsWith(SEARCH_ACTIVE_PREFIX)
}

const fetchFile = async url => {
    const res = await fetch(url)
    if (!res.ok) throw new ResponseError(
        `${res.status} ${res.statusText}`, { cause: res })
    return new File([await res.blob()], new URL(res.url).pathname)
}

export const makeBook = async file => {
    if (typeof file === 'string') file = await fetchFile(file)
    let book
    if (file.isDirectory) {
        const loader = await makeDirectoryLoader(file)
        const { EPUB } = await import('./epub.js')
        book = await new EPUB(loader).init()
    }
    else if (!file.size) throw new NotFoundError('File not found')
    else if (await isZip(file)) {
        const loader = await makeZipLoader(file)
        if (isCBZ(file)) {
            const { makeComicBook } = await import('./comic-book.js')
            book = makeComicBook(loader, file)
        }
        else if (isFBZ(file)) {
            const { makeFB2 } = await import('./fb2.js')
            const { entries } = loader
            const entry = entries.find(entry => entry.filename.endsWith('.fb2'))
            const blob = await loader.loadBlob((entry ?? entries[0]).filename)
            book = await makeFB2(blob)
        }
        else {
            const { EPUB } = await import('./epub.js')
            book = await new EPUB(loader).init()
        }
    }
    else if (await isPDF(file)) {
        const { makePDF } = await import('./pdf.js')
        book = await makePDF(file)
    }
    else {
        const { isMOBI, MOBI } = await import('./mobi.js')
        if (await isMOBI(file)) {
            const fflate = await import('./vendor/fflate.js')
            book = await new MOBI({ unzlib: fflate.unzlibSync }).open(file)
        }
        else if (isFB2(file)) {
            const { makeFB2 } = await import('./fb2.js')
            book = await makeFB2(file)
        }
    }
    if (!book) throw new UnsupportedTypeError('File type not supported')
    return book
}

class CursorAutohider {
    #timeout
    #el
    #check
    #state
    constructor(el, check, state = {}) {
        this.#el = el
        this.#check = check
        this.#state = state
        if (this.#state.hidden) this.hide()
        this.#el.addEventListener('mousemove', ({ screenX, screenY }) => {
            // check if it actually moved
            if (screenX === this.#state.x && screenY === this.#state.y) return
            this.#state.x = screenX, this.#state.y = screenY
            this.show()
            if (this.#timeout) clearTimeout(this.#timeout)
            if (check()) this.#timeout = setTimeout(this.hide.bind(this), 1000)
        }, false)
    }
    cloneFor(el) {
        return new CursorAutohider(el, this.#check, this.#state)
    }
    hide() {
        this.#el.style.cursor = 'none'
        this.#state.hidden = true
    }
    show() {
        this.#el.style.removeProperty('cursor')
        this.#state.hidden = false
    }
}

class History extends EventTarget {
    #arr = []
    #index = -1
    pushState(x) {
        const last = this.#arr[this.#index]
        if (last === x || last?.fraction && last.fraction === x.fraction) return
        this.#arr[++this.#index] = x
        this.#arr.length = this.#index + 1
        this.dispatchEvent(new Event('index-change'))
    }
    replaceState(x) {
        const index = this.#index
        this.#arr[index] = x
    }
    back() {
        const index = this.#index
        if (index <= 0) return
        const detail = { state: this.#arr[index - 1] }
        this.#index = index - 1
        this.dispatchEvent(new CustomEvent('popstate', { detail }))
        this.dispatchEvent(new Event('index-change'))
    }
    forward() {
        const index = this.#index
        if (index >= this.#arr.length - 1) return
        const detail = { state: this.#arr[index + 1] }
        this.#index = index + 1
        this.dispatchEvent(new CustomEvent('popstate', { detail }))
        this.dispatchEvent(new Event('index-change'))
    }
    get canGoBack() {
        return this.#index > 0
    }
    get canGoForward() {
        return this.#index < this.#arr.length - 1
    }
    clear() {
        this.#arr = []
        this.#index = -1
    }
}

const languageInfo = lang => {
    if (!lang) return {}
    try {
        const canonical = Intl.getCanonicalLocales(lang)[0]
        const locale = new Intl.Locale(canonical)
        const isCJK = ['zh', 'ja', 'kr'].includes(locale.language)
        const direction = (locale.getTextInfo?.() ?? locale.textInfo)?.direction
        return { canonical, locale, isCJK, direction }
    } catch (e) {
        console.warn(e)
        return {}
    }
}

export class View extends HTMLElement {
    #root = this.attachShadow({ mode: 'open' })
    #sectionProgress
    #tocProgress
    #pageProgress
    #cfiProgress
    #searchResults = new Map()
    #suppressedImageClicks = new WeakSet()
    #ttsValue
    #cursorAutohider = new CursorAutohider(this, () =>
        this.hasAttribute('autohide-cursor'))
    isFixedLayout = false
    lastLocation
    history = new History()
    constructor() {
        super()
        this.history.addEventListener('popstate', ({ detail }) => {
            const resolved = this.resolveNavigation(detail.state)
            this.renderer.goTo(resolved)
        })
    }
    async open(book) {
        if (typeof book === 'string'
        || typeof book.arrayBuffer === 'function'
        || book.isDirectory) book = await makeBook(book)
        this.book = book
        this.language = languageInfo(book.metadata?.language)

        if (book.splitTOCHref && book.getTOCFragment) {
            const ids = book.sections.map(s => s.id)
            this.#sectionProgress = new SectionProgress(book.sections, 1500, 1600)
            const splitHref = book.splitTOCHref.bind(book)
            const getFragment = book.getTOCFragment.bind(book)
            this.#tocProgress = new TOCProgress()
            await this.#tocProgress.init({
                toc: book.toc ?? [], ids, splitHref, getFragment })
            this.#pageProgress = new TOCProgress()
            await this.#pageProgress.init({
                toc: book.pageList ?? [], ids, splitHref, getFragment })
        }
        this.#cfiProgress = new PageProgress(book, this.resolveNavigation.bind(this))

        this.isFixedLayout = this.book.rendition?.layout === 'pre-paginated'
        if (this.isFixedLayout) {
            await import('./fixed-layout.js')
            this.renderer = document.createElement('foliate-fxl')
        } else {
            await import('./paginator.js')
            this.renderer = document.createElement('foliate-paginator')
        }
        this.renderer.setAttribute('exportparts', 'head,foot,filter,container')
        this.renderer.addEventListener('load', e => this.#onLoad(e.detail))
        this.renderer.addEventListener('relocate', e => this.#onRelocate(e.detail))
        this.renderer.addEventListener('stabilized', () => this.#emit('stabilized'))
        this.renderer.addEventListener('create-overlayer', e => {
            const { detail } = e
            const overlayer = this.#createOverlayer(detail)
            detail.attach(overlayer)
            const list = this.#searchResults.get(detail.index)
            if (list) for (const item of list) this.addAnnotation(item)
            // Publish only after attach so annotation listeners can resolve
            // and draw ranges on the newly created overlay.
            this.#emit('create-overlay', { index: detail.index })
        })
        this.renderer.open(book)
        this.#root.append(this.renderer)

        if (book.sections.some(section => section.mediaOverlay)) {
            book.media.activeClass ||= '-epub-media-overlay-active'
            const activeClass = book.media.activeClass
            const playbackActiveClass = book.media.playbackActiveClass
            this.mediaOverlay = book.getMediaOverlay()
            let lastActive
            this.mediaOverlay.addEventListener('highlight', e => {
                const resolved = this.resolveNavigation(e.detail.text)
                this.renderer.goTo(resolved)
                    .then(() => {
                        const { doc } = this.renderer.getContents()
                            .find(x => x.index = resolved.index)
                        const el = resolved.anchor(doc)
                        el.classList.add(activeClass)
                        if (playbackActiveClass) el.ownerDocument
                            .documentElement.classList.add(playbackActiveClass)
                        lastActive = new WeakRef(el)
                    })
            })
            this.mediaOverlay.addEventListener('unhighlight', () => {
                const el = lastActive?.deref()
                if (el) {
                    el.classList.remove(activeClass)
                    if (playbackActiveClass) el.ownerDocument
                        .documentElement.classList.remove(playbackActiveClass)
                }
            })
        }
    }
    close() {
        if (this.#ttsValue) {
            this.#getOverlayer()?.overlayer.remove(this.#ttsValue)
            this.#ttsValue = null
        }
        this.renderer?.destroy()
        this.renderer?.remove()
        this.#sectionProgress = null
        this.#tocProgress = null
        this.#pageProgress = null
        this.#cfiProgress = null
        this.#searchResults = new Map()
        this.lastLocation = null
        this.history.clear()
        this.tts = null
        this.mediaOverlay = null
    }
    goToTextStart() {
        return this.goTo(this.book.landmarks
            ?.find(m => m.type.includes('bodymatter') || m.type.includes('text'))
            ?.href ?? this.book.sections.findIndex(s => s.linear !== 'no'))
    }
    async init({ lastLocation, showTextStart }) {
        const resolved = lastLocation ? this.resolveNavigation(lastLocation) : null
        if (resolved) {
            await this.renderer.goTo(resolved)
            this.history.pushState(lastLocation)
        }
        else if (showTextStart) await this.goToTextStart()
        else {
            this.history.pushState(0)
            await this.next()
        }
    }
    #emit(name, detail, cancelable) {
        return this.dispatchEvent(new CustomEvent(name, { detail, cancelable }))
    }
    #onRelocate({ reason, range, index, fraction, size }) {
        const progress = this.#sectionProgress?.getProgress(index, fraction, size) ?? {}
        const tocItem = this.#tocProgress?.getProgress(index, range)
        const pageItem = this.#pageProgress?.getProgress(index, range)
        const cfi = this.getCFI(index, range)
        const totalPages = this.renderer?.pages
            ? this.renderer.pages - 2
            : progress.section?.total
        const currentPage = this.renderer?.page ?? progress.section?.current
        const chapterLocation = { current: currentPage, total: totalPages }
        this.lastLocation = { ...progress, tocItem, pageItem, cfi, range, chapterLocation }
        if (reason === 'snap' || reason === 'page' || reason === 'scroll')
            this.history.replaceState(cfi)
        this.#emit('relocate', this.lastLocation)
    }
    #onLoad({ doc, index }) {
        // set language and dir if not already set
        doc.documentElement.lang ||= this.language.canonical ?? ''
        if (!this.language.isCJK)
            doc.documentElement.dir ||= this.language.direction ?? ''

        this.#handleLinks(doc, index)
        this.#handleMedia(doc, index)
        this.#handleContextMenu(doc, index)
        this.#handleClick(doc, index)
        this.#cursorAutohider.cloneFor(doc.documentElement)

        this.#emit('load', { doc, index })
    }
    #handleMedia(doc, index) {
        doc.addEventListener('error', event => {
            let element = event.target
            if (element?.localName === 'source' || element?.localName === 'track')
                element = element.closest('audio, video')
            if (!['audio', 'video', 'object', 'embed'].includes(element?.localName)) return
            const hasDeferredSource = element.hasAttribute('data-bd-deferred-src')
                || !!element.querySelector('[data-bd-deferred-src]')
            const hasPlayableSource = !!(element.currentSrc
                || element.getAttribute('src')
                || element.getAttribute('data')
                || element.querySelector('source[src]')?.getAttribute('src'))
            if (hasDeferredSource && !hasPlayableSource) return
            if (element.dataset.bookdockMediaError === '1') return
            element.dataset.bookdockMediaError = '1'
            const src = element.currentSrc
                || element.getAttribute('src')
                || element.getAttribute('data')
                || element.querySelector('source[src]')?.getAttribute('src')
                || ''
            this.#emit('media-error', {
                sectionIndex: index,
                kind: element.localName,
                src,
            })
        }, true)
        doc.addEventListener('play', event => {
            const element = event.target
            if (element?.localName === 'audio' || element?.localName === 'video') {
                this.#emit('media-play', {
                    sectionIndex: index,
                    kind: element.localName,
                })
            }
        }, true)
    }
    #handleLinks(doc, index) {
        const { book } = this
        const section = book.sections[index]
        doc.addEventListener('click', e => {
            const a = e.target.closest('a[href]')
            if (!a) return
            e.preventDefault()
            const href_ = a.getAttribute('href')
            const href = section?.resolveHref?.(href_) ?? href_
            if (book?.isExternal?.(href))
                Promise.resolve(this.#emit('external-link', { a, href }, true))
                    .then(x => x ? globalThis.open(href, '_blank') : null)
                    .catch(e => console.error(e))
            else {
                let internalHref = href
                if (!book.resolveHref(href)) {
                    const hashIndex = href_.indexOf('#')
                    if (hashIndex >= 0) {
                        const hash = href_.slice(hashIndex)
                        internalHref = section?.resolveHref?.(hash) ?? href
                    }
                }
                Promise.resolve(this.#emit('link', { a, href: internalHref }, true))
                    .then(x => x ? this.goTo(internalHref) : null)
                    .catch(e => console.error(e))
            }
        })
    }
    #getImageDetail(index, image) {
        const svgImage = image.localName === 'image'
        const rawSrc = svgImage
            ? image.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
                ?? image.getAttribute('xlink:href')
                ?? image.getAttribute('href')
            : image.currentSrc || image.getAttribute('src')
        let src = rawSrc ?? ''
        if (src && svgImage) {
            try { src = new URL(src, image.baseURI).href } catch { /* keep the raw reference */ }
        }
        const range = image.ownerDocument.createRange()
        range.selectNode(image)
        let cfi = ''
        try {
            cfi = this.getCFI(index, range)
        } catch (e) {
            console.warn(e)
        }
        return {
            sectionIndex: index,
            cfi,
            src,
            alt: image.getAttribute('alt')
                ?? image.closest('figure')?.querySelector('figcaption')?.textContent?.trim()
                ?? '',
            title: image.getAttribute('title') ?? '',
            kind: svgImage ? 'svg-image' : 'image',
        }
    }
    #handleContextMenu(doc, index) {
        let longPressTimer = null
        let longPressPointerId = null
        let longPressStart = null
        let longPressTriggered = false
        const suppressImageClick = image => {
            this.#suppressedImageClicks.add(image)
            setTimeout(() => this.#suppressedImageClicks.delete(image), 1000)
        }
        const cancelLongPress = () => {
            if (longPressTimer !== null) clearTimeout(longPressTimer)
            longPressTimer = null
            longPressPointerId = null
            longPressStart = null
        }
        const eligibleImage = target => {
            let image = target?.closest?.('img, image')
            if (!image) {
                const svg = target?.closest?.('svg')
                if (svg) image = svg.querySelector('image, img')
            }
            if (!image) return null
            if (image.closest('a[href], button, input, select, textarea')) return null
            return image
        }
        const coordinates = (clientX, clientY) => {
            const iframe = doc.defaultView?.frameElement
            if (iframe) {
                const rect = iframe.getBoundingClientRect()
                return { x: clientX + rect.left, y: clientY + rect.top }
            }
            return { x: clientX, y: clientY }
        }
        const emitMenu = (image, clientX, clientY) => {
            const detail = this.#getImageDetail(index, image)
            if (!detail.src) return false
            const point = coordinates(clientX, clientY)
            this.#emit('open-media-menu', { ...detail, x: point.x, y: point.y })
            return true
        }
        doc.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse') return
            const image = eligibleImage(event.target)
            if (!image) return
            cancelLongPress()
            longPressTriggered = false
            longPressPointerId = event.pointerId
            longPressStart = { x: event.clientX, y: event.clientY }
            longPressTimer = setTimeout(() => {
                if (!longPressStart || !image.isConnected) return
                if (!emitMenu(image, longPressStart.x, longPressStart.y)) return
                longPressTriggered = true
                suppressImageClick(image)
            }, 500)
        })
        doc.addEventListener('pointermove', event => {
            if (event.pointerId !== longPressPointerId || !longPressStart) return
            if (Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 10) {
                longPressTriggered = false
                cancelLongPress()
            }
        })
        const endLongPress = event => {
            if (event.pointerId !== longPressPointerId) return
            if (!longPressTriggered) cancelLongPress()
            else {
                longPressPointerId = null
                longPressStart = null
            }
        }
        doc.addEventListener('pointerup', endLongPress)
        doc.addEventListener('pointercancel', endLongPress)
        doc.addEventListener('contextmenu', e => {
            if (e.defaultPrevented || doc.getSelection()?.type === 'Range') return
            const image = eligibleImage(e.target)
            if (!image) return
            e.preventDefault()
            if (longPressTriggered) {
                longPressTriggered = false
                cancelLongPress()
                return
            }
            const hadTouchPress = longPressPointerId !== null
            cancelLongPress()
            if (emitMenu(image, e.clientX, e.clientY) && hadTouchPress) suppressImageClick(image)
        })
    }
    #handleClick(doc, index) {
        doc.addEventListener('click', e => {
            if (e.defaultPrevented || doc.getSelection()?.type === 'Range') return
            let image = e.target?.closest?.('img, image')
            if (!image) {
                const svg = e.target?.closest?.('svg')
                if (svg) image = svg.querySelector('image, img')
            }
            if (image) {
                if (this.#suppressedImageClicks.has(image)) {
                    this.#suppressedImageClicks.delete(image)
                    return
                }
                const control = image.closest('a[href], button, input, select, textarea')
                if (control) return
                this.#emit('open-media', this.#getImageDetail(index, image))
                return
            }
            const target = e.target?.closest?.('a, button, input, select, textarea, audio, video, object, embed, iframe')
            if (target) return
            let { clientX, clientY } = e
            const overlay = this.#getOverlayer(index)?.overlayer
            if (isInteractiveAnnotationHit(overlay, { x: clientX, y: clientY })) return
            const position = doc.position
            const scale = doc.scale ?? 1
            if (position) {
                clientX *= scale
                clientY *= scale
                const docWidth = doc.documentElement.getBoundingClientRect().width * scale
                if (position === 'right' && docWidth * 2.2 < window.innerWidth)
                    clientX += window.innerWidth * 0.5
            } else {
                const iframe = doc.defaultView?.frameElement
                if (iframe) {
                    const rect = iframe.getBoundingClientRect()
                    clientX += rect.left
                    clientY += rect.top
                }
            }
            this.#emit('click-view', { x: clientX, y: clientY })
        })
    }
    async addAnnotation(annotation, remove) {
        const { value } = annotation
        if (value.startsWith(SEARCH_PREFIX)) {
            const cfi = value.replace(SEARCH_PREFIX, '')
            const { index, anchor } = await this.resolveNavigation(cfi)
            const obj = this.#getOverlayer(index)
            if (obj) {
                const { overlayer, doc } = obj
                if (remove) {
                    overlayer.remove(value)
                    return
                }
                const range = doc ? anchor(doc) : anchor
                if (range) overlayer.add(value, range, Overlayer.highlight, {
                    color: 'var(--bd-search-highlight, #facc15)',
                    fillOpacity: 0.32,
                })
            }
            return
        } else if (value.startsWith(SEARCH_ACTIVE_PREFIX)) {
            const cfi = value.replace(SEARCH_ACTIVE_PREFIX, '')
            const { index, anchor } = await this.resolveNavigation(cfi)
            const obj = this.#getOverlayer(index)
            if (obj) {
                const { overlayer, doc } = obj
                if (remove) {
                    overlayer.remove(value)
                    return
                }
                const range = doc ? anchor(doc) : anchor
                if (range) overlayer.add(value, range, Overlayer.highlight, {
                    color: 'var(--bd-search-active-highlight, #fbbf24)',
                    fillOpacity: 0.4,
                    stroke: 'var(--bd-search-active-border, #d97706)',
                    strokeWidth: 1.5,
                    strokeOpacity: 0.9,
                })
            }
            return
        } else if (value.startsWith(NOTE_PREFIX)) {
            const cfi = value.replace(NOTE_PREFIX, '')
            const { index, anchor } = await this.resolveNavigation(cfi)
            const obj = this.#getOverlayer(index)
            if (obj) {
                const { overlayer, doc } = obj
                if (remove) {
                    overlayer.remove(value)
                    return
                }
                const range = doc ? anchor(doc) : anchor
                if (range) {
                    const draw = (func, opts) => overlayer.add(value, range, func, opts)
                    this.#emit('draw-annotation', { draw, annotation, doc, range })
                }
            }
            return
        }
        const navigationValue = value.includes('|') ? value.slice(0, value.indexOf('|')) : value
        const { index, anchor } = await this.resolveNavigation(navigationValue)
        const obj = this.#getOverlayer(index)
        if (obj) {
            const { overlayer, doc } = obj
            overlayer.remove(value)
            if (!remove) {
                const range = doc ? anchor(doc) : anchor
                if (range) {
                    const draw = (func, opts) => overlayer.add(value, range, func, opts)
                    this.#emit('draw-annotation', { draw, annotation, doc, range })
                }
            }
        }
        const label = this.#tocProgress?.getProgress(index)?.label ?? ''
        return { index, label }
    }
    deleteAnnotation(annotation) {
        return this.addAnnotation(annotation, true)
    }
    #getOverlayer(index) {
        return this.renderer.getContents()
            .find(x => x.index === index && x.overlayer)
    }
    #createOverlayer({ doc, index }) {
        const overlayer = new Overlayer(doc)
        doc.addEventListener('click', e => {
            const [value, range, rect] = overlayer.hitTest(e)
            if (value && !value.startsWith(SEARCH_PREFIX) && !value.startsWith(SEARCH_ACTIVE_PREFIX)) {
                this.#emit('show-annotation', { value, index, range, rect })
            }
        }, false)

        let lastHitTestTime = 0
        const THROTTLE_MS = 200
        const isAndroid = /Android/i.test(navigator.userAgent)

        doc.addEventListener('mousemove', (e) => {
            if (isAndroid) return
            const now = performance.now()
            if (now - lastHitTestTime < THROTTLE_MS) return
            lastHitTestTime = now
            const [value] = overlayer.hitTest(e)
            if (value && !value.startsWith(SEARCH_PREFIX) && !value.startsWith(SEARCH_ACTIVE_PREFIX)) {
                doc.body.style.cursor = 'pointer'
            } else {
                doc.body.style.cursor = ''
            }
        })

        return overlayer
    }
    async showAnnotation(annotation) {
        const { value } = annotation
        const resolved = await this.goTo(value)
        if (resolved) {
            const { index, anchor } = resolved
            const { doc } =  this.#getOverlayer(index)
            const range = anchor(doc)
            this.#emit('show-annotation', { value, index, range })
        }
    }
    getCFI(index, range) {
        const baseCFI = this.book.sections[index].cfi ?? CFI.fake.fromIndex(index)
        if (!range) return baseCFI
        return CFI.joinIndir(baseCFI, CFI.fromRange(range))
    }
    resolveCFI(cfi) {
        if (this.book.resolveCFI)
            return this.book.resolveCFI(cfi)
        else {
            const parts = CFI.parse(cfi)
            const index = CFI.fake.toIndex((parts.parent ?? parts).shift())
            const anchor = doc => CFI.toRange(doc, parts)
            return { index, anchor }
        }
    }
    resolveNavigation(target) {
        try {
            if (typeof target === 'number') return { index: target }
            if (typeof target.fraction === 'number') {
                const [index, anchor] = this.#sectionProgress.getSection(target.fraction)
                return { index, anchor }
            }
            if (CFI.isCFI.test(target)) return this.resolveCFI(target)
            return this.book.resolveHref(target)
        } catch (e) {
            console.error(e)
            console.error(`Could not resolve target ${target}`)
        }
    }
    async goTo(target) {
        const resolved = this.resolveNavigation(target)
        try {
            await this.renderer.goTo(resolved)
            this.history.pushState(target)
            return resolved
        } catch(e) {
            console.error(e)
            console.error(`Could not go to ${target}`)
        }
    }
    async goToFraction(frac) {
        const [index, anchor] = this.#sectionProgress.getSection(frac)
        await this.renderer.goTo({ index, anchor })
        this.history.pushState({ fraction: frac })
    }
    async select(target) {
        try {
            const obj = await this.resolveNavigation(target)
            await this.renderer.goTo({ ...obj, select: true })
            this.history.pushState(target)
        } catch(e) {
            console.error(e)
            console.error(`Could not go to ${target}`)
        }
    }
    deselect() {
        for (const { doc } of this.renderer.getContents())
            doc.defaultView.getSelection().removeAllRanges()
    }
    getSectionFractions() {
        return (this.#sectionProgress?.sectionFractions ?? [])
            .map(x => x + Number.EPSILON)
    }
    getProgressOf(index, range) {
        const tocItem = this.#tocProgress?.getProgress(index, range)
        const pageItem = this.#pageProgress?.getProgress(index, range)
        return { tocItem, pageItem }
    }
    async getCFIProgress(cfi) {
        const progress = await this.#cfiProgress?.getProgress(cfi)
        if (!progress || progress.index === -1) return null
        return this.#sectionProgress?.getProgress(progress.index, progress.fraction)
    }
    async getTOCItemOf(target) {
        try {
            const { index, anchor } = await this.resolveNavigation(target)
            const doc = await this.book.sections[index].createDocument()
            const frag = anchor(doc)
            const isRange = frag instanceof Range
            const range = isRange ? frag : doc.createRange()
            if (!isRange) range.selectNodeContents(frag)
            return this.#tocProgress?.getProgress(index, range)
        } catch(e) {
            console.error(e)
            console.error(`Could not get ${target}`)
        }
    }
    async prev(distance) {
        await this.renderer.prev(distance)
    }
    async next(distance) {
        await this.renderer.next(distance)
    }
    async pan(dx, dy) {
        await this.renderer.pan(dx, dy)
    }
    isOverflowX() {
        return this.renderer.isOverflowX
    }
    isOverflowY() {
        return this.renderer.isOverflowY
    }
    goLeft() {
        return this.book.dir === 'rtl' ? this.next() : this.prev()
    }
    goRight() {
        return this.book.dir === 'rtl' ? this.prev() : this.next()
    }
    // A matcher result carries a primary `range` (nav/excerpt anchor) and, for
    // nearby-words, per-word `subRanges` to highlight each matched word.
    #toSearchMatch(index, { range, excerpt, subRanges }) {
        const cfi = this.getCFI(index, range)
        if (subRanges?.length)
            return { cfi, cfis: subRanges.map(r => this.getCFI(index, r)), excerpt }
        return { cfi, excerpt }
    }
    async * #searchSection(matcher, query, index) {
        const doc = await this.book.sections[index].createDocument()
        for (const match of matcher(doc, query))
            yield this.#toSearchMatch(index, match)
    }
    async * #searchBook(matcher, query) {
        const { sections } = this.book
        for (const [index, { createDocument }] of sections.entries()) {
            if (!createDocument) continue
            const doc = await createDocument()
            const subitems = Array.from(matcher(doc, query), match => this.#toSearchMatch(index, match))
            const progress = (index + 1) / sections.length
            yield { progress }
            if (subitems.length) yield { index, subitems }
        }
    }
    async * search(opts) {
        this.clearSearch()
        const { searchMatcher } = await import('./search.js')
        const { sections } = this.book
        const { query, index, results } = opts
        const matcher = searchMatcher(textWalker,
            { defaultLocale: this.language, ...opts })

        const iter = results?.length
            ? (async function* () {
                for (const result of results) {
                    if (result.subitems) {
                        const progress = (result.index + 1) / sections.length
                        yield { progress }
                        yield { index: result.index, subitems: result.subitems }
                    } else {
                        yield { cfi: result.cfi, cfis: result.cfis, excerpt: result.excerpt }
                    }
                }
            })()
            : index != null
                ? this.#searchSection(matcher, query, index)
                : this.#searchBook(matcher, query)

        const list = []
        const seen = new Set()
        this.#searchResults.set(index, list)
        // Add one annotation per unique CFI (a nearby-words match carries several
        // via `cfis`); dedupe so overlapping CFIs don't collide in #searchResults.
        const addHighlights = (cfis, sink, sinkSeen) => {
            for (const cfi of cfis) {
                if (sinkSeen.has(cfi)) continue
                sinkSeen.add(cfi)
                const item = { value: SEARCH_PREFIX + cfi }
                sink.push(item)
                this.addAnnotation(item)
            }
        }

        for await (const result of iter) {
            if (result.subitems){
                const sectionList = []
                const sectionSeen = new Set()
                for (const item of result.subitems)
                    addHighlights(item.cfis ?? [item.cfi], sectionList, sectionSeen)
                this.#searchResults.set(result.index, sectionList)
                yield {
                    index: result.index,
                    label: this.#tocProgress?.getProgress(result.index)?.label ?? '',
                    subitems: result.subitems,
                }
            }
            else {
                if (result.cfi) addHighlights(result.cfis ?? [result.cfi], list, seen)
                yield result
            }
        }
        yield 'done'
    }
    clearSearch() {
        for (const list of this.#searchResults.values())
            for (const item of list) this.deleteAnnotation(item)
        this.#searchResults.clear()
    }
    async initTTS(granularity = 'word', nodeFilter, highlighter) {
        const contents = this.renderer.getContents()
        const primaryIndex = this.renderer.primaryIndex
        const primary = contents.find(x => x.index === primaryIndex) ?? contents[0]
        const doc = primary?.doc
        if (!doc) return
        if (granularity === true) {
            if (this.#ttsValue) {
                this.#getOverlayer(primaryIndex)?.overlayer.remove(this.#ttsValue)
                this.#ttsValue = null
            }
            this.tts = null
            return
        }
        if (this.tts && this.tts.doc === doc) return
        const { TTS } = await import('./tts.js')
        if (granularity === false) {
            const getCfi = range => this.getCFI(primaryIndex, range)
            const legacyHighlighter = range => {
                const obj = this.#getOverlayer(primaryIndex)
                if (!obj) return null
                if (this.#ttsValue) obj.overlayer.remove(this.#ttsValue)
                const value = `tts:${getCfi(range)}`
                obj.overlayer.add(value, range, Overlayer.highlight,
                    { color: 'var(--bd-tts-highlight)' })
                this.#ttsValue = value
                return value
            }
            this.tts = new TTS(doc, textWalker, legacyHighlighter, getCfi)
            return this.tts
        }
        this.tts = new TTS(doc, textWalker, nodeFilter, highlighter || (range =>
            this.renderer.scrollToAnchor(range, true)), granularity)
        return this.tts
    }
    startMediaOverlay() {
        const contents = this.renderer.getContents()
        const primaryIndex = this.renderer.primaryIndex
        const primary = contents.find(x => x.index === primaryIndex) ?? contents[0]
        const { index } = primary ?? {}
        return this.mediaOverlay.start(index)
    }
}

customElements.define('foliate-view', View)
