import type {
  BookReader,
  ChineseConversion,
  ContinuousScroll,
  FontConfig,
  ParagraphStyle,
  PopupRect,
  ReaderAnnotation,
  ReaderLocation,
  ReadingMode,
  RendererEvents,
  SearchOptions,
  SearchResult,
} from '../types'
import { FONT_OPTIONS } from '../types'
import { convertChinese } from '@/lib/chinese'

const ANNOTATION_COLORS: Record<string, string> = {
  yellow: '#eab308',
  red: '#ef4444',
  purple: '#a855f7',
  blue: '#3b82f6',
  green: '#22c55e',
}
const DEFAULT_ANNOTATION_COLOR = ANNOTATION_COLORS.yellow

export class FoliateReader implements BookReader {
  private url: string
  private container: HTMLElement | null = null
  private view: any | null = null
  private book: any | null = null
  private listeners: { type: string; fn: (...args: unknown[]) => void }[] = []
  private tocHrefToIndex = new Map<string, number>()
  private readingMode: ReadingMode = 'scroll'
  private pageColumns = 2
  private columnGap = 5
  private font: FontConfig = {
    fontFamily: 'serif',
    size: 18,
    lineHeight: 1.8,
    fontWeight: 400,
    overrideBookFont: true,
  }
  private paragraph: ParagraphStyle = {
    paragraphSpacing: 0.5,
    letterSpacing: 0,
    indent: 2,
    verticalPadding: 0,
    horizontalPadding: 0,
    textAlignJustify: false,
    overrideBookLayout: true,
  }
  private theme: { bg: string; text: string } = { bg: '#ffffff', text: '#000000' }
  private pageWidth = 0
  private lastFraction: number | null = null
  private currentDoc: Document | null = null
  private conversion: ChineseConversion = 'off'
  private currentSectionIndex = 0
  private activeDocs = new Set<Document>()
  private selectionDocs = new Map<Document, { index: number; handler: () => void }>()
  private selectionActive = false
  private foliateOverlayer: any = null
  private annotationMap = new Map<string, ReaderAnnotation>()
  // cfiRange -> render key (`${type}|${color}`); a key change means remove + re-add
  private renderedAnnotations = new Map<string, string>()
  private handleDocInteraction = () => {
    this.container?.dispatchEvent(new CustomEvent('content-click'))
  }

  private destroyed = false

  constructor(url: string) {
    this.url = url
  }

  async mount(container: HTMLElement) {
    this.container = container
    try {
      const foliate = await this.loadFoliateScript()
      const { EPUB, configure, ZipReader, BlobReader, TextWriter, BlobWriter } = foliate
      this.foliateOverlayer = foliate.Overlayer

      const ac = new AbortController()
      const timeoutId = setTimeout(() => ac.abort(), 60000)
      const res = await fetch(this.url, { signal: ac.signal })
      clearTimeout(timeoutId)
      if (!res.ok) throw new Error(`fetch epub failed: ${res.status} ${res.statusText}`)
      const file = await res.blob()
      configure({ useWebWorkers: false })

      const reader = new ZipReader(new BlobReader(file))
      const entries: any[] = await reader.getEntries()
      const map = new Map(entries.map((entry: any) => [entry.filename, entry]))

      const load = (fn: (entry: any) => any) => (name: string) => {
        const entry = map.get(name)
        return entry ? fn(entry) : null
      }

      const loadText = load((entry: any) => entry.getData(new TextWriter()))
      const loadBlob = load((entry: any, type?: string) => entry.getData(new BlobWriter(type)))
      const getSize = (name: string) => map.get(name)?.uncompressedSize ?? 0

      const epub = await new EPUB({ loadText, loadBlob, getSize }).init()
      // StrictMode mounts twice: the first instance is destroyed while its
      // async mount is still in flight — bail out instead of becoming a
      // zombie view stacked on top of the surviving one
      if (this.destroyed) return
      this.book = epub

      const view = document.createElement('foliate-view') as any
      view.style.display = 'block'
      view.style.width = '100%'
      view.style.height = '100%'
      this.view = view

      view.addEventListener('relocate', (event: Event) => {
        this.handleRelocate((event as CustomEvent).detail)
        this.syncDoc()
      })
      view.addEventListener('load', () => this.syncDoc())
      view.addEventListener('draw-annotation', (event: Event) =>
        this.handleDrawAnnotation((event as CustomEvent).detail))
      view.addEventListener('show-annotation', (event: Event) =>
        this.handleShowAnnotation((event as CustomEvent).detail))
      // Newly rendered sections get their annotations re-applied
      view.addEventListener('create-overlay', () => {
        for (const value of this.renderedAnnotations.keys()) {
          Promise.resolve(this.view?.addAnnotation({ value })).catch(() => {})
        }
      })

      container.appendChild(view)
      await view.open(epub)
      if (this.destroyed) {
        try { view.close() } catch { /* partial init */ }
        view.remove()
        return
      }

      this.applyAllSettings()
      this.syncAnnotations()
      this.emit('rendered')
      this.syncDoc()
    } catch (err) {
      console.error('[FoliateReader] mount error:', err)
      throw err
    }
  }

  private async loadFoliateScript(): Promise<any> {
    if (typeof window === 'undefined') throw new Error('FoliateReader requires a browser environment')
    const existing = (window as any).FoliateReader
    if (existing) return existing

    // foliate-js expects these from the host app (desktop Foliate)
    if (typeof (window as any).isFootNoteOpen !== 'function') {
      (window as any).isFootNoteOpen = () => false
    }
    if (typeof (window as any).closeFootNote !== 'function') {
      (window as any).closeFootNote = () => {}
    }

    try {
      const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, unknown>>
      const mod = await dynamicImport('/foliate-js/reader-entry.js')
      const fr = (window as any).FoliateReader ?? mod?.FoliateReader
      if (!fr) throw new Error('FoliateReader global not set — module may have thrown during evaluation')
      return fr
    } catch (e) {
      console.error('[FoliateReader] dynamic import error:', e)
      throw e
    }
  }

  private handleRelocate(detail: any) {
    const { cfi, fraction, tocItem, section, chapterLocation } = detail
    // fraction is NaN on transient relocate paths (section reload with zero viewSize)
    const frac = Number.isFinite(fraction) ? fraction : this.lastFraction
    if (frac != null) this.lastFraction = frac
    // chapter progress: foliate sections map 1:1 to the book's chapter list
    const chapterIndex = Number.isFinite(section?.current) ? section.current : undefined
    if (chapterIndex !== undefined) this.currentSectionIndex = chapterIndex
    const chapterTotal = Number.isFinite(section?.total) ? section.total : undefined
    let pageInChapter = chapterLocation?.current
    try {
      const r = this.view?.renderer
      if (r?.getAttribute?.('flow') === 'scrolled' && r.size > 0) {
        // in scrolled flow chapterLocation is the section index, not a page —
        // approximate pages-into-chapter by container screens instead
        pageInChapter = Math.floor(r.start / r.size)
      }
    } catch {
      // renderer not ready
    }
    const location: ReaderLocation = {
      cfi: cfi ?? '',
      percent: frac != null ? Math.round(frac * 100) : 0,
      chapter: tocItem?.label,
      chapterIndex,
      page: chapterIndex != null ? chapterIndex + 1 : undefined,
      total: chapterTotal,
      pageInChapter,
    }
    try {
      this.view?.renderer?.setMarginals?.({
        header: this.bookTitle(),
        footer: tocItem?.label ?? '',
      })
    } catch {
      // renderer not ready
    }
    this.emit('relocated', location)
  }

  async display(target?: string) {
    if (!this.view) return
    const renderer = this.view.renderer
    if (!target) {
      if (renderer) return renderer.goTo({ index: 0 })
      return this.view.goTo(0)
    }
    if (target.startsWith('chapter:')) {
      const index = Number(target.split(':')[1])
      if (!Number.isNaN(index) && renderer) return renderer.goTo({ index })
    }

    // CFI locations (search results, bookmarks, selections) go straight to
    // View.goTo — href resolution would mangle or reject them
    if (/^epubcfi\(/.test(target)) {
      try {
        const resolved = await this.view.goTo(target)
        if (!resolved) console.warn('[FoliateReader] CFI navigation returned nothing:', target)
      } catch (err) {
        console.error('[FoliateReader] CFI navigation failed:', target, err)
      }
      return
    }

    // Try EPUB's built-in href resolver (handles path normalization)
    let resolved = this.book?.resolveHref?.(target)
    if (!resolved) {
      // Try decoding the path — sometimes there's an encoding mismatch
      resolved = this.book?.resolveHref?.(decodeURI(target))
    }
    if (!resolved) {
      // Fallback: look up TOC href in our index map
      const index = this.tocHrefToIndex.get(target)
      if (index !== undefined) resolved = { index }
    }
    if (resolved && renderer) {
      return renderer.goTo(resolved)
    }

    // Last resort: let View.goTo handle it (silently catches errors)
    return this.view.goTo(target)
  }

  async next() {
    if (this.readingMode === 'page') {
      await this.view?.next()
    } else {
      await this.view?.renderer?.nextSection()
    }
  }

  async prev() {
    if (this.readingMode === 'page') {
      await this.view?.prev()
    } else {
      await this.view?.renderer?.prevSection()
    }
  }

  applyReadingMode(mode: ReadingMode) {
    this.readingMode = mode
    if (!this.view?.renderer) return
    this.view.renderer.setAttribute('flow', mode === 'page' ? 'paginated' : 'scrolled')
    this.updateLayout()
    this.applyStyles()
  }

  applyPageColumns(columns: number) {
    this.pageColumns = Math.max(1, Math.min(3, columns))
    if (!this.view?.renderer) return
    this.view.renderer.setAttribute('max-column-count', String(this.pageColumns))
  }

  applyColumnGap(gapPercent: number) {
    this.columnGap = Math.max(0, Math.min(15, gapPercent))
    if (!this.view?.renderer) return
    this.view.renderer.setAttribute('gap', String(this.columnGap))
  }

  applyPageAnimation(enabled: boolean) {
    if (!this.view?.renderer) return
    this.view.renderer.toggleAttribute('animated', enabled)
  }

  applyShowHeader(enabled: boolean) {
    if (!this.view?.renderer) return
    this.view.renderer.toggleAttribute('show-header', enabled)
  }

  applyShowFooter(enabled: boolean) {
    if (!this.view?.renderer) return
    this.view.renderer.toggleAttribute('show-footer', enabled)
  }

  private bookTitle(): string {
    const title = this.book?.metadata?.title
    return typeof title === 'string' ? title : ''
  }

  applyReadingTheme(theme: { bg: string; text: string }) {
    this.theme = theme
    if (!this.view?.renderer) return
    this.view.renderer.setAttribute('background-color', theme.bg)
    this.applyStyles()
  }

  applyFont(cfg: FontConfig) {
    this.font = cfg
    this.applyStyles()
  }

  applyParagraphStyle(cfg: ParagraphStyle) {
    this.paragraph = cfg
    this.applyStyles()
    this.updateLayout()
  }

  applyPageWidth(width: number) {
    this.pageWidth = width
    this.updateLayout()
  }

  // The paginator centers the column area (max-inline-size) inside the viewport, so in
  // paginated mode side insets must come from shrinking that area — body padding inside
  // the iframe only applies to the first/last page of the fragmented flow. Same for
  // vertical insets, which the paginator supports via top/bottom-margin attributes.
  private updateLayout() {
    if (!this.view?.renderer) return
    const base = this.pageWidth > 0 ? this.pageWidth : 720
    const isPage = this.readingMode === 'page'
    const inset = isPage ? this.paragraph.horizontalPadding * 2 : 0
    this.view.renderer.setAttribute('max-inline-size', String(Math.max(320, base - inset)))
    const vPad = isPage ? this.paragraph.verticalPadding : 0
    this.view.renderer.setAttribute('top-margin', `${vPad}px`)
    this.view.renderer.setAttribute('bottom-margin', `${vPad}px`)
  }

  applyChineseConversion(mode: ChineseConversion) {
    this.conversion = mode
    if (!this.view?.renderer) return
    for (const { doc } of this.view.renderer.getContents()) {
      this.convertDocument(doc)
    }
    // Conversion rewrites every text node, killing foliate's range anchor. The native
    // anchor restore can't run in that case, so re-anchor by book fraction instead.
    const fraction = this.lastFraction
    if (fraction != null) {
      requestAnimationFrame(() => {
        try {
          void this.view?.goToFraction?.(fraction)
        } catch {
          // view may be mid-teardown
        }
      })
    }
  }

  private async convertDocument(doc: Document) {
    if (this.conversion === 'off') return
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    let n: Text | null
    while ((n = walker.nextNode() as Text | null)) nodes.push(n)
    for (const node of nodes) {
      if (node.textContent) {
        node.textContent = await convertChinese(node.textContent, this.conversion)
      }
    }
  }

  applyContinuousScroll(mode: ContinuousScroll) {
    if (mode === 'seamless') this.applyReadingMode('scroll')
    const renderer = this.view?.renderer
    if (!renderer) return
    // snap-turn and continuous are mutually exclusive in the paginator
    if (mode === 'snap') {
      renderer.setAttribute('snap-turn', '')
      renderer.removeAttribute('continuous')
    } else if (mode === 'seamless') {
      renderer.removeAttribute('snap-turn')
      renderer.setAttribute('continuous', '')
    } else {
      renderer.removeAttribute('snap-turn')
      renderer.removeAttribute('continuous')
    }
  }

  async scrollToPercent(percent: number) {
    await this.view?.goToFraction(Math.max(0, Math.min(1, percent / 100)))
  }

  async scrollByPages(delta: number) {
    const steps = Math.abs(delta)
    for (let i = 0; i < steps; i++) {
      if (delta > 0) await this.view?.next()
      else await this.view?.prev()
    }
  }

  // --- Selection & annotations -------------------------------------------

  private popupRect(doc: Document, range: Range): PopupRect | undefined {
    try {
      const frame = doc.defaultView?.frameElement as HTMLElement | null
      if (!frame) return undefined
      const frameRect = frame.getBoundingClientRect()
      const rect = range.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) return undefined
      return {
        left: frameRect.left + rect.left,
        top: frameRect.top + rect.top,
        width: rect.width,
        height: rect.height,
      }
    } catch {
      return undefined
    }
  }

  private handleSelection(doc: Document, index: number) {
    // The selection is not final yet on mouseup/keyup — read it after this tick
    setTimeout(() => {
      try {
        const sel = doc.defaultView?.getSelection?.()
        const range = sel && !sel.isCollapsed && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
        const text = range?.toString().replace(/\s+/g, ' ').trim() ?? ''
        if (!range || !text) {
          if (this.selectionActive) {
            this.selectionActive = false
            this.emit('selected', null)
          }
          return
        }
        const cfiRange = this.view?.getCFI?.(index, range)
        if (!cfiRange) return
        this.selectionActive = true
        this.emit('selected', {
          cfiRange,
          text: text.slice(0, 500),
          rect: this.popupRect(doc, range),
        })
      } catch {
        // ignore selection errors
      }
    }, 0)
  }

  clearSelection() {
    try { this.view?.deselect?.() } catch { /* view may be gone */ }
    if (this.selectionActive) {
      this.selectionActive = false
      this.emit('selected', null)
    }
  }

  setAnnotations(annotations: ReaderAnnotation[]) {
    this.annotationMap = new Map(annotations.map((a) => [a.cfiRange, a]))
    this.syncAnnotations()
  }

  private syncAnnotations() {
    if (!this.view) return
    const next = new Map(
      Array.from(this.annotationMap.values(), (a) => [a.cfiRange, `${a.type}|${a.color}|${a.style ?? ''}`] as const),
    )
    for (const value of Array.from(this.renderedAnnotations.keys())) {
      if (!next.has(value)) {
        this.renderedAnnotations.delete(value)
        Promise.resolve(this.view.deleteAnnotation({ value })).catch(() => {})
      }
    }
    for (const [value, key] of next) {
      if (this.renderedAnnotations.get(value) === key) continue
      if (this.renderedAnnotations.has(value)) {
        Promise.resolve(this.view.deleteAnnotation({ value })).catch(() => {})
      }
      this.renderedAnnotations.set(value, key)
      Promise.resolve(this.view.addAnnotation({ value })).catch(() => {})
    }
  }

  private handleDrawAnnotation(detail: any) {
    const { draw, annotation } = detail ?? {}
    if (!draw || !annotation?.value || !this.foliateOverlayer) return
    const ann = this.annotationMap.get(annotation.value)
    const color = ANNOTATION_COLORS[ann?.color ?? ''] ?? DEFAULT_ANNOTATION_COLOR
    const style = ann?.style ?? 'underline'
    if (style === 'highlight') {
      draw(this.foliateOverlayer.highlight, { color: `${color}55` })
    } else {
      draw(style === 'squiggly' ? this.foliateOverlayer.squiggly : this.foliateOverlayer.underline, { color })
    }
  }

  private handleShowAnnotation(detail: any) {
    const { value, index, range } = detail ?? {}
    if (!value) return
    try {
      const contents = this.view?.renderer?.getContents?.() ?? []
      const match = contents.find((c: any) => c.index === index)
      const rect = match?.doc && range ? this.popupRect(match.doc, range) : undefined
      this.emit('annotationClicked', { cfiRange: value, rect })
    } catch {
      this.emit('annotationClicked', { cfiRange: value })
    }
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    if (!query.trim() || !this.view) return []
    const index = opts?.scope === 'chapter' ? this.currentSectionIndex : undefined
    const matchRegex = opts?.mode === 'regex'
    const results: SearchResult[] = []
    let i = 0
    // foliate's excerpt is {pre, match, post}, not a plain string
    const toResult = (cfi: string, excerpt: any): SearchResult => ({
      cfi,
      text: excerpt ? `${excerpt.pre}${excerpt.match}${excerpt.post}` : '',
      index: i++,
      excerpt: excerpt ?? undefined,
    })
    for await (const item of this.view.search({ query: query.trim(), index, matchCase: opts?.matchCase, matchRegex })) {
      if (item === 'done') break
      if (item.subitems) {
        for (const sub of item.subitems) results.push(toResult(sub.cfi, sub.excerpt))
      } else if (item.cfi) {
        results.push(toResult(item.cfi, item.excerpt))
      }
    }
    return results
  }

  getSnippet(cfi: string, maxLength = 80): string {
    try {
      const resolved = this.book?.resolveCFI?.(cfi)
      if (!resolved) return ''
      const contents = this.view?.renderer?.getContents?.() ?? []
      // the bookmark is always created on a currently rendered section
      const match = contents.find((c: any) => c.index === resolved.index)
      if (!match?.doc) return ''
      const range = resolved.anchor(match.doc)
      // the range comes from the iframe's realm, so instanceof checks fail;
      // duck-type it instead
      if (!range?.startContainer || typeof range.toString !== 'function') return ''
      return this.snippetFromRange(range, maxLength)
    } catch {
      return ''
    }
  }

  // Text starting at the range's start point. Location CFIs collapse to a
  // point, so walk forward through text nodes when the range itself is empty.
  private snippetFromRange(range: Range, maxLength: number): string {
    const direct = range.toString().replace(/\s+/g, ' ').trim()
    if (direct) return direct.slice(0, maxLength)
    const doc = range.startContainer.ownerDocument
    if (!doc?.body) return ''
    let text = ''
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      text += (range.startContainer.textContent ?? '').slice(range.startOffset)
      walker.currentNode = range.startContainer
    } else {
      const node = range.startContainer.childNodes[range.startOffset] ?? range.startContainer
      walker.currentNode = node
    }
    let next: Node | null
    while (text.length < maxLength && (next = walker.nextNode())) {
      text += next.textContent ?? ''
    }
    return text.replace(/\s+/g, ' ').trim().slice(0, maxLength)
  }

  private buildTocIndex() {
    this.tocHrefToIndex.clear()
    const visit = (items: any[], baseIndex: number) => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.href) this.tocHrefToIndex.set(item.href, baseIndex + i)
        if (item.subitems) visit(item.subitems, baseIndex + i + 1)
      }
    }
    if (this.book?.toc) visit(this.book.toc, 0)
  }

  on<K extends keyof RendererEvents>(type: K, fn: RendererEvents[K]) {
    this.listeners.push({ type, fn: fn as (...args: unknown[]) => void })
    if (type === 'tocReady') {
      this.buildTocIndex()
      const toc =
        this.book?.toc?.map((item: any) => ({
          label: item.label,
          href: item.href,
          level: item.level ?? 1,
        })) ?? []
      ;(fn as RendererEvents['tocReady'])(toc)
    }
    return () => {
      this.listeners = this.listeners.filter((l) => l.fn !== fn)
    }
  }

  private syncDoc() {
    try {
      const contents = this.view?.renderer?.getContents?.() as Array<{ doc: Document; index: number }> | undefined
      if (!contents?.length) return

      const docs = new Set<Document>(contents.map((c) => c.doc).filter(Boolean))
      for (const doc of this.activeDocs) {
        if (!docs.has(doc)) {
          doc.removeEventListener('click', this.handleDocInteraction)
          const sel = this.selectionDocs.get(doc)
          if (sel) {
            doc.removeEventListener('mouseup', sel.handler)
            doc.removeEventListener('keyup', sel.handler)
            this.selectionDocs.delete(doc)
          }
        }
      }
      for (const { doc, index } of contents) {
        if (!doc || this.activeDocs.has(doc)) continue
        doc.addEventListener('click', this.handleDocInteraction)
        const handler = () => this.handleSelection(doc, index)
        doc.addEventListener('mouseup', handler)
        doc.addEventListener('keyup', handler)
        this.selectionDocs.set(doc, { index, handler })
      }
      this.activeDocs = docs

      const doc = contents[0].doc
      if (!doc || doc === this.currentDoc) return
      this.currentDoc = doc
      if (this.conversion !== 'off') {
        this.convertDocument(doc)
      }
    } catch {
      // ignore sync errors — the renderer may not be fully initialized yet
    }
  }

  destroy() {
    this.destroyed = true
    try { this.view?.close() } catch { /* view may be partially initialized */ }
    try { this.view?.remove() } catch { /* ignore */ }
    for (const doc of this.activeDocs) {
      doc.removeEventListener('click', this.handleDocInteraction)
      const sel = this.selectionDocs.get(doc)
      if (sel) {
        doc.removeEventListener('mouseup', sel.handler)
        doc.removeEventListener('keyup', sel.handler)
      }
    }
    this.selectionDocs.clear()
    this.activeDocs.clear()
    this.view = null
    this.book = null
    this.container = null
  }

  private applyAllSettings() {
    this.applyReadingMode(this.readingMode)
    this.applyPageColumns(this.pageColumns)
    this.applyColumnGap(this.columnGap)
    this.applyPageWidth(0)
    this.applyReadingTheme(this.theme)
    this.applyStyles()
  }

  private applyStyles() {
    if (!this.view?.renderer?.setStyles) return
    const font = FONT_OPTIONS.find((f) => f.id === this.font.fontFamily) ?? FONT_OPTIONS[0]
    const css = `
      html, body {
        font-family: ${font.value} !important;
        font-size: ${this.font.size}px !important;
        line-height: ${this.font.lineHeight} !important;
        font-weight: ${this.font.fontWeight} !important;
        letter-spacing: ${this.paragraph.letterSpacing}px !important;
        color: ${this.theme.text} !important;
        background: ${this.theme.bg} !important;
        background-color: ${this.theme.bg} !important;
      }
      p {
        text-indent: ${this.paragraph.indent}em !important;
        margin-bottom: ${this.paragraph.paragraphSpacing}em !important;
        text-align: ${this.paragraph.textAlignJustify ? 'justify' : 'start'} !important;
      }
      body {
        padding-top: ${this.readingMode === 'page' ? 0 : this.paragraph.verticalPadding}px !important;
        padding-bottom: ${this.readingMode === 'page' ? 0 : this.paragraph.verticalPadding}px !important;
        padding-left: ${this.readingMode === 'page' ? 0 : this.paragraph.horizontalPadding}px !important;
        padding-right: ${this.readingMode === 'page' ? 0 : this.paragraph.horizontalPadding}px !important;
      }
    `
    this.view.renderer.setStyles(css)
  }

  private emit<K extends keyof RendererEvents>(type: K, data?: Parameters<RendererEvents[K]>[0]) {
    this.listeners
      .filter((l) => l.type === type)
      .forEach((l) => l.fn(data))
  }
}
