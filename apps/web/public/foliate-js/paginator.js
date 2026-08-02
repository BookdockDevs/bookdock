const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const lerp = (min, max, x) => x * (max - min) + min
const easeOutSine = x => Math.sin((x * Math.PI) / 2)
// const easeOutSine = x => 1 - (1 - x) * (1 - x);
const animate = (a, b, duration, ease, render) => new Promise(resolve => {
  let start
  const step = now => {
    start ??= now
    const fraction = Math.min(1, (now - start) / duration)
    render(lerp(a, b, ease(fraction)))
    if (fraction < 1) requestAnimationFrame(step)
    else resolve()
  }
  requestAnimationFrame(step)
})

// collapsed range doesn't return client rects sometimes (or always?)
// try make get a non-collapsed range or element
const uncollapse = range => {
  if (!range?.collapsed) return range
  const { endOffset, endContainer } = range
  if (endContainer.nodeType === 1) return endContainer
  if (endOffset + 1 < endContainer.length) range.setEnd(endContainer, endOffset + 1)
  else if (endOffset > 1) range.setStart(endContainer, endOffset - 1)
  else return endContainer.parentNode
  return range
}

const makeRange = (doc, node, start, end = start) => {
  const range = doc.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  return range
}

// use binary search to find an offset value in a text node
const bisectNode = (doc, node, cb, start = 0, end = node.nodeValue.length) => {
  if (end - start === 1) {
    const result = cb(makeRange(doc, node, start), makeRange(doc, node, end))
    return result < 0 ? start : end
  }
  const mid = Math.floor(start + (end - start) / 2)
  const result = cb(makeRange(doc, node, start, mid), makeRange(doc, node, mid, end))
  return result < 0 ? bisectNode(doc, node, cb, start, mid)
    : result > 0 ? bisectNode(doc, node, cb, mid, end) : mid
}

const { SHOW_ELEMENT, SHOW_TEXT, SHOW_CDATA_SECTION,
  FILTER_ACCEPT, FILTER_REJECT, FILTER_SKIP } = NodeFilter

const filter = SHOW_ELEMENT | SHOW_TEXT | SHOW_CDATA_SECTION

const getVisibleRange = (doc, start, end, mapRect) => {
  // first get all visible nodes
  const acceptNode = node => {
    const name = node.localName?.toLowerCase()
    // ignore all scripts, styles, and their children
    if (name === 'script' || name === 'style') return FILTER_REJECT
    if (node.nodeType === 1) {
      const { left, right } = mapRect(node.getBoundingClientRect())
      // no need to check child nodes if it's completely out of view
      if (right < start || left > end) return FILTER_REJECT
      // elements must be completely in view to be considered visible
      // because you can't specify offsets for elements
      if (left >= start && right <= end) return FILTER_ACCEPT
      // TODO: it should probably allow elements that do not contain text
      // because they can exceed the whole viewport in both directions
      // especially in scrolled mode
    } else {
      // ignore empty text nodes
      if (!node.nodeValue?.trim()) return FILTER_REJECT
      // create range to get rect
      const range = doc.createRange()
      range.selectNodeContents(node)
      const { left, right } = mapRect(range.getBoundingClientRect())
      // it's visible if any part of it is in view
      if (right >= start && left <= end) return FILTER_ACCEPT
    }
    return FILTER_SKIP
  }
  if (!doc) return
  const walker = doc.createTreeWalker(doc.body, filter, { acceptNode })
  const nodes = []
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    nodes.push(node)

  // we're only interested in the first and last visible nodes
  const from = nodes[0] ?? doc.body
  const to = nodes[nodes.length - 1] ?? from

  // find the offset at which visibility changes
  const startOffset = from.nodeType === 1 ? 0
    : bisectNode(doc, from, (a, b) => {
      const p = mapRect(a.getBoundingClientRect())
      const q = mapRect(b.getBoundingClientRect())
      if (p.right < start && q.left > start) return 0
      return q.left > start ? -1 : 1
    })
  const endOffset = to.nodeType === 1 ? 0
    : bisectNode(doc, to, (a, b) => {
      const p = mapRect(a.getBoundingClientRect())
      const q = mapRect(b.getBoundingClientRect())
      if (p.right < end && q.left > end) return 0
      return q.left > end ? -1 : 1
    })

  const range = doc.createRange()
  range.setStart(from, startOffset)
  range.setEnd(to, endOffset)
  return range
}

const getDirection = doc => {
  const { defaultView } = doc
  const { writingMode, direction } = defaultView.getComputedStyle(doc.body)
  const vertical = writingMode === 'vertical-rl'
    || writingMode === 'vertical-lr'
  const rtl = doc.body.dir === 'rtl'
    || direction === 'rtl'
    || doc.documentElement.dir === 'rtl'
  return { vertical, rtl, writingMode }
}

// const getBackground = doc => {
//   const bodyStyle = doc.defaultView.getComputedStyle(doc.body)
//   return bodyStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
//     && bodyStyle.backgroundImage === 'none'
//     ? doc.defaultView.getComputedStyle(doc.documentElement).background
//     : bodyStyle.background
// }
const getBackground = (bgimgUrl) => {
  let bg
  if (bgimgUrl === 'none') {
    bg = `none`
  } else {
    bg = `url(${bgimgUrl})`
  }
  return bg
}

const applyBackground = (el, bgimgUrl, blur, opacity, fit) => {
  el.style.background = getBackground(bgimgUrl)
  el.style.backgroundPosition = 'center center'
  el.style.backgroundRepeat = 'no-repeat'
  el.style.backgroundAttachment = 'scroll'
  el.style.backgroundSize = fit === 'stretch' ? '100% 100%' : 'cover'
  el.style.filter = (blur && blur > 0) ? `blur(${blur}px)` : ''
  el.style.opacity = (opacity != null) ? opacity : 1
  // Expand the background element beyond its grid cell when blur is active so
  // the blurred edges are not clipped by the parent overflow:hidden boundary.
  if (blur && blur > 0) {
    const expand = `${blur * 2}px`
    el.style.margin = `-${expand}`
    el.style.width = `calc(100% + ${expand} * 2)`
    el.style.height = `calc(100% + ${expand} * 2)`
    // Keep the visual fill identical to the unblurred state; only the
    // element bounds expand so blurred edges can bleed outside the viewport.
  } else {
    el.style.margin = ''
    el.style.width = ''
    el.style.height = ''
  }
}

const makeMarginals = (length, part) => Array.from({ length }, () => {
  const div = document.createElement('div')
  const child = document.createElement('div')
  div.append(child)
  child.setAttribute('part', part)
  return div
})

const setStylesImportant = (el, styles) => {
  const { style } = el
  for (const [k, v] of Object.entries(styles)) style.setProperty(k, v, 'important')
}

class View {
  #observer = new ResizeObserver(() => this.expand())
  #element = document.createElement('div')
  #iframe = document.createElement('iframe')
  #contentRange = document.createRange()
  #overlayer
  #vertical = false
  #rtl = false
  #writingMode = 'horizontal-ltr'
  #column = true
  #size
  #layout = {}
  constructor({ container, onExpand }) {
    this.container = container
    this.onExpand = onExpand
    this.#iframe.setAttribute('part', 'filter')
    this.#element.append(this.#iframe)
    Object.assign(this.#element.style, {
      boxSizing: 'content-box',
      position: 'relative',
      overflow: 'hidden',
      flex: '0 0 auto',
      width: '100%', height: '100%',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      contain: 'layout paint size',
      contentVisibility: 'auto',
      willChange: 'transform',
    })
    Object.assign(this.#iframe.style, {
      overflow: 'hidden',
      border: '0',
      display: 'none',
      width: '100%', height: '100%',
    })
    // `allow-scripts` is needed for events because of WebKit bug
    // https://bugs.webkit.org/show_bug.cgi?id=218086
    this.#iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
    this.#iframe.setAttribute('scrolling', 'no')
  }
  get element() {
    return this.#element
  }
  get document() {
    return this.#iframe.contentDocument
  }
  async load(src, afterLoad, beforeRender) {
    if (typeof src !== 'string') throw new Error(`${src} is not string`)
    return new Promise(resolve => {
      this.#iframe.addEventListener('load', () => {
        const doc = this.document
        afterLoad?.(doc)

        // it needs to be visible for Firefox to get computed style
        this.#iframe.style.display = 'block'
        const { vertical, rtl, writingMode } = getDirection(doc)
        this.#iframe.style.display = 'none'

        this.#vertical = vertical
        this.#rtl = rtl
        this.#writingMode = writingMode

        this.#contentRange.selectNodeContents(doc.body)
        const layout = beforeRender?.({ vertical, rtl })
        this.#iframe.style.display = 'block'
        this.render(layout)
        this.#observer.observe(doc.body)

        // the resize observer above doesn't work in Firefox
        // (see https://bugzilla.mozilla.org/show_bug.cgi?id=1832939)
        // until the bug is fixed we can at least account for font load
        doc.fonts.ready.then(() => this.expand())

        resolve()
      }, { once: true })
      this.#iframe.src = src
    })
  }
  render(layout) {
    if (!layout) return
    this.#column = layout.flow !== 'scrolled'
    this.#layout = layout
    if (this.#column) this.columnize(layout)
    else this.scrolled(layout)
  }
  scrolled({ gap, columnWidth }) {
    const vertical = this.#vertical
    const doc = this.document
    if (!doc) return
    setStylesImportant(doc.documentElement, {
      'box-sizing': 'border-box',
      'padding': vertical ? `${gap}px 0` : `0 ${gap}px`,
      'column-width': 'auto',
      'height': 'auto',
      'width': 'auto',
    })
    setStylesImportant(doc.body, {
      [vertical ? 'max-height' : 'max-width']: `${columnWidth}px`,
      'margin': 'auto',
    })
    this.setImageSize()
    this.expand()
  }
  columnize({ width, height, gap, columnWidth, topMargin, bottomMargin }) {
    const vertical = this.#vertical
    this.#size = vertical ? height : width

    const doc = this.document

    const verticlePadding = `${gap / 2}px ${topMargin}px ${gap / 2}px ${bottomMargin}px`
    const horizontalPadding = `${topMargin}px ${gap / 2}px ${bottomMargin}px ${gap / 2}px`

    setStylesImportant(doc.documentElement, {
      'box-sizing': 'border-box',
      'column-width': `${Math.trunc(columnWidth)}px`,
      'column-gap': `${gap}px`,
      'column-fill': 'auto',
      ...(vertical
        ? { 'width': `${width}px` }
        : { 'height': `${height}px` }),
      'padding': vertical ? verticlePadding : horizontalPadding,
      'overflow': 'hidden',
      // force wrap long words
      'overflow-wrap': 'break-word',
      // reset some potentially problematic props
      'position': 'static', 'border': '0', 'margin': '0',
      'max-height': 'none', 'max-width': 'none',
      'min-height': 'none', 'min-width': 'none',
      // fix glyph clipping in WebKit
      '-webkit-line-box-contain': 'block glyphs replaced',
    })
    setStylesImportant(doc.body, {
      'max-height': 'none',
      'max-width': 'none',
      'margin': '0',
    })
    this.setImageSize()
    this.expand()
  }
  setImageSize() {
    const { width, height, margin, columnWidth } = this.#layout
    const vertical = this.#vertical
    const doc = this.document
    for (const el of doc.body.querySelectorAll('img, svg, video')) {
      // preserve max size if they are already set
      const { maxHeight, maxWidth } = doc.defaultView.getComputedStyle(el)
      // Cap max-width to the column width to prevent images from overflowing
      // into the next page when the EPUB embeds a large inline max-width value.
      const effectiveMaxWidth = vertical
        ? `${width - margin * 2}px`
        : columnWidth
          ? `${columnWidth}px`
          : (maxWidth !== 'none' && maxWidth !== '0px' ? maxWidth : '100%')
      setStylesImportant(el, {
        'max-height': vertical
          ? (maxHeight !== 'none' && maxHeight !== '0px' ? maxHeight : '100%')
          : `${height - margin * 2}px`,
        'max-width': effectiveMaxWidth,
        'object-fit': 'contain',
        'page-break-inside': 'avoid',
        'break-inside': 'avoid',
        'box-sizing': 'border-box',
      })
    }
  }
  expand() {
    const { documentElement } = this.document
    if (this.#column) {
      const side = this.#vertical ? 'height' : 'width'
      const otherSide = this.#vertical ? 'width' : 'height'
      this.#contentRange.selectNodeContents(this.document.body)
      const contentRect = this.#contentRange.getBoundingClientRect()
      const rootRect = documentElement.getBoundingClientRect()
      // offset caused by column break at the start of the page
      // which seem to be supported only by WebKit and only for horizontal writing
      const contentStart = this.#vertical ? 0
        : this.#rtl ? rootRect.right - contentRect.right : contentRect.left - rootRect.left
      const contentSize = contentStart + contentRect[side]
      const pageCount = Math.ceil(contentSize / this.#size)
      const expandedSize = pageCount * this.#size
      this.#element.style.padding = '0'
      this.#iframe.style[side] = `${expandedSize}px`
      this.#element.style[side] = `${expandedSize + this.#size * 2}px`
      this.#iframe.style[otherSide] = '100%'
      this.#element.style[otherSide] = '100%'
      documentElement.style[side] = `${this.#size}px`
      if (this.#overlayer) {
        this.#overlayer.element.style.margin = '0'
        this.#overlayer.element.style.left = this.#vertical ? '0' : `${this.#size}px`
        this.#overlayer.element.style.top = this.#vertical ? `${this.#size}px` : '0'
        this.#overlayer.element.style[side] = `${expandedSize}px`
        this.#overlayer.redraw()
      }
    } else {
      const side = this.#vertical ? 'width' : 'height'
      const otherSide = this.#vertical ? 'height' : 'width'
      const contentSize = documentElement.getBoundingClientRect()[side]
      const expandedSize = contentSize
      const { margin } = this.#layout
      const padding = this.#vertical ? `0 ${margin}px` : `${margin}px 0`
      this.#element.style.padding = padding
      this.#iframe.style[side] = `${expandedSize}px`
      this.#element.style[side] = `${expandedSize}px`
      this.#iframe.style[otherSide] = '100%'
      this.#element.style[otherSide] = '100%'
      if (this.#overlayer) {
        this.#overlayer.element.style.margin = padding
        this.#overlayer.element.style.left = '0'
        this.#overlayer.element.style.top = '0'
        this.#overlayer.element.style[side] = `${expandedSize}px`
        this.#overlayer.redraw()
      }
    }
    this.onExpand()
  }
  set overlayer(overlayer) {
    this.#overlayer = overlayer
    this.#element.append(overlayer.element)
  }
  get overlayer() {
    return this.#overlayer
  }
  get writingMode() {
    return this.#writingMode
  }
  destroy() {
    if (this.document) this.#observer.unobserve(this.document.body)
  }
}

// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class Paginator extends HTMLElement {
  static observedAttributes = [
    'flow', 'gap', 'top-margin', 'bottom-margin', 'background-color',
    'max-inline-size', 'max-block-size', 'max-column-count', 'column-threshold', 'bgimg-url',
    'bgimg-blur', 'bgimg-opacity', 'bgimg-fit', 'snap-turn', 'continuous',
  ]
  #root = this.attachShadow({ mode: 'open' })
  #observer = new ResizeObserver(() => this.render())
  #top
  #background
  #container
  #header
  #footer
  #view
  // Multi-view ("continuous" seamless scroll) state. #view stays the primary
  // view; #views additionally holds adjacent preloaded sections. The map is
  // only populated while #continuous is active, so the default single-view
  // path is untouched.
  #views = new Map()
  #filling = false
  #lastLayout = null
  #headerText = ''
  #footerText = ''
  #vertical = false
  #rtl = false
  #margin = 0
  #index = -1
  #anchor = 0 // anchor view to a fraction (0-1), Range, or Element
  #justAnchored = false
  #locked = false // while true, prevent any further navigation
  #styles
  #styleMap = new WeakMap()
  #mediaQuery = matchMedia('(prefers-color-scheme: dark)')
  #mediaQueryListener
  #ignoreNativeScroll = false
  #pendingScrollFrame = null
  #pendingScrollTimer = null
  #touchState
  #touchScrolled
  #loadingNext = false
  #loadingPrev = false
  #pendingRelocate = null
  #isSnapping = false
  #snapTurn = false
  #snapNavigating = false
  #wheelAccum = 0
  #snapCooldownUntil = 0
  #pageWheelAccum = 0
  #pageWheelCooldownUntil = 0
  static SNAP_DELTA_THRESHOLD = 150
  static SNAP_COOLDOWN = 600
  // Paginated wheel turns: one wheel notch is ~100px, so a low threshold makes
  // a single notch flip exactly one page; the cooldown paces rapid gestures.
  static PAGE_WHEEL_THRESHOLD = 40
  static PAGE_WHEEL_COOLDOWN = 200
  constructor() {
    super()
    this.#root.innerHTML = `<style>
        :host {
            display: block;
            container-type: size;
        }
        :host, #top {
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            width: 100%;
            height: 100%;
        }
        #top {
            height: 100%;
            // --_gap: 7%;
            background-color: var(--_background-color);
            --_max-inline-size: 720px;
            --_max-block-size: 1440px;
            --_max-column-count: 2;
            --_max-column-count-portrait: 1;
            --_max-column-count-spread: var(--_max-column-count);
            --_half-gap: calc(var(--_gap) / 2);
            --_max-width: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            --_max-height: var(--_max-block-size);
            display: grid;
            grid-template-columns:
                minmax(var(--_half-gap), 1fr)
                var(--_half-gap)
                minmax(0, calc(var(--_max-width) - var(--_gap)))
                var(--_half-gap)
                minmax(var(--_half-gap), 1fr);
            grid-template-rows:
                var(--_top-margin)
                1fr
                var(--_bottom-margin);
            &.vertical {
                --_max-column-count-spread: var(--_max-column-count-portrait);
                --_max-width: var(--_max-block-size);
                --_max-height: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            }
            @container (orientation: portrait) {
                & {
                    --_max-column-count-spread: var(--_max-column-count-portrait);
                }
                &.vertical {
                    --_max-column-count-spread: var(--_max-column-count);
                }
            }
        }
        #background {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
        }
        #container {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
            overflow-x: auto;
            overflow-y: hidden;
            -webkit-overflow-scrolling: touch;
            -ms-overflow-style: none;  /* Internet Explorer 10+ */
            scrollbar-width: none;  /* Firefox */
        }
        #container::-webkit-scrollbar {
            display: none;  /* Safari and Chrome */
        }
        :host([flow="scrolled"]) #container {
            grid-column: 1 / -1;
            grid-row: 2;
            overflow: auto;
        }
        #header {
            grid-column: 1 / -1;
            grid-row: 1;
        }
        #footer {
            grid-column: 1 / -1;
            grid-row: 3;
        }
        #header, #footer {
            display: grid;
        }
        :is(#header, #footer) > * {
            display: flex;
            align-items: center;
            min-width: 0;
        }
        /* marginal text hugs the content side of its band: header bottom,
           footer top — keeping both equidistant from the screen edges */
        #header > * {
            align-items: flex-end;
            padding-bottom: 6px;
        }
        #footer > * {
            align-items: flex-start;
            padding-top: 6px;
        }
        :is(#header, #footer) > * > * {
            width: 100%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            text-align: center;
            font-size: .75em;
            opacity: .6;
        }
        :host([flow="scrolled"]) :is(#header, #footer) {
            display: none;
        }
        :host(:not([show-header])) #header {
            display: none;
        }
        :host(:not([show-footer])) #footer {
            display: none;
        }
        </style>
        <div id="top">
            <div id="background" part="filter"></div>
            <div id="container"></div>
            <div id="header"></div>
            <div id="footer"></div>
        </div>
        `

    this.#top = this.#root.getElementById('top')
    this.#background = this.#root.getElementById('background')
    this.#container = this.#root.getElementById('container')
    this.#header = this.#root.getElementById('header')
    this.#footer = this.#root.getElementById('footer')

    this.#observer.observe(this.#container)
    this.#container.addEventListener('scroll', () => {
      if (this.#ignoreNativeScroll) return
      if (this.#justAnchored) {
        this.#justAnchored = false
        return
      }
      if (this.scrolled) {
        // Top up the seamless buffer immediately (not debounced) so scrolling
        // never dead-ends at an unloaded section boundary.
        if (this.#continuous) this.#checkBuffers()
        // Debounce like upstream: relayouts (style/font/margin changes) briefly clamp
        // scrollTop to 0, and a per-frame handler would capture that transient position
        // as the new anchor before the re-anchor runs — jumping to the section start.
        if (this.#pendingScrollTimer) clearTimeout(this.#pendingScrollTimer)
        this.#pendingScrollTimer = setTimeout(() => {
          this.#pendingScrollTimer = null
          this.#afterScroll('scroll')
        }, 150)
        return
      }
      if (this.#pendingScrollFrame)
        cancelAnimationFrame(this.#pendingScrollFrame)
      this.#pendingScrollFrame = requestAnimationFrame(() => {
        this.#pendingScrollFrame = null
        this.#afterScroll('scroll')
      })
    })

    const opts = { passive: false }
    this.addEventListener('touchstart', this.#onTouchStart.bind(this), opts)
    this.addEventListener('touchmove', this.#onTouchMove.bind(this), opts)
    this.addEventListener('touchend', this.#onTouchEnd.bind(this), opts)
    this.addEventListener('wheel', e => this.#onWheel(e), { passive: true })
    this.addEventListener('load', ({ detail: { doc } }) => {
      doc.addEventListener('touchstart', this.#onTouchStart.bind(this), opts)
      doc.addEventListener('touchmove', this.#onTouchMove.bind(this), opts)
      doc.addEventListener('touchend', this.#onTouchEnd.bind(this), opts)
      doc.addEventListener('wheel', e => this.#onWheel(e), { passive: true })
      // Key events inside the iframe never reach the top window, so page-mode
      // keyboard turns must be handled here; the app-level window handler
      // covers the iframe-unfocused case, and the two never fire together.
      doc.addEventListener('keydown', e => this.#onDocKey(e))
    })

    this.#mediaQueryListener = () => {
      if (!this.#view) return
      this.#applyBackground()
    }
    this.#mediaQuery.addEventListener('change', this.#mediaQueryListener)
  }
  attributeChangedCallback(name, _, value) {
    switch (name) {
      case 'flow':
        this.render()
        break
      case 'top-margin':
      case 'max-block-size':
      case 'background-color':
        this.#top.style.setProperty('--_' + name, value)
        break
      case 'bottom-margin':
      case 'gap':
      case 'max-column-count':
      case 'column-threshold':
      case 'max-inline-size':
        // needs explicit `render()` as it doesn't necessarily resize
        this.#top.style.setProperty('--_' + name, value)
        this.render()
        break
      case 'bgimg-url':
      case 'bgimg-blur':
      case 'bgimg-opacity':
      case 'bgimg-fit':
        if (this.#background) this.#applyBackground()
        break
      case 'snap-turn':
        this.#snapTurn = value !== null
        this.#wheelAccum = 0
        break
      case 'continuous':
        if (value === null) {
          // Escape hatch off: drop every non-primary view so the single-view
          // path sees exactly the DOM it expects.
          for (const [i] of [...this.#views])
            if (i !== this.#index) this.#destroyViewAt(i)
          this.#views.clear()
        } else if (this.#continuous && this.#view) {
          this.#views.set(this.#index, this.#view)
          this.#fillVisibleArea()
        }
        break
    }
  }
  open(book) {
    this.bookDir = book.dir
    this.sections = book.sections
    this.#views.clear()
  }
  #applyBackground() {
    const url = this.getAttribute('bgimg-url') ?? 'none'
    const blur = parseFloat(this.getAttribute('bgimg-blur') ?? '0')
    const opacity = parseFloat(this.getAttribute('bgimg-opacity') ?? '1')
    const fit = this.getAttribute('bgimg-fit') ?? 'cover'
    applyBackground(this.#background, url, blur, opacity, fit)
  }
  #createView() {
    if (this.#view) {
      // In continuous mode a kept adjacent view may still be the current
      // #view when jumping to a nearby section; keep it in the map then.
      let oldMapIndex = null
      for (const [i, v] of this.#views) if (v === this.#view) { oldMapIndex = i; break }
      const keepOld = this.#continuous && oldMapIndex != null && oldMapIndex !== this.#index
      if (!keepOld) {
        this.#view.destroy()
        // The view may already be detached (e.g. culled by a far jump or the
        // continuous-mode cleanup); removeChild on a non-child throws.
        if (this.#view.element.parentNode === this.#container)
          this.#container.removeChild(this.#view.element)
        if (oldMapIndex != null) this.#views.delete(oldMapIndex)
      }
    }
    this.#view = new View({
      container: this,
      onExpand: () => this.scrollToAnchor(this.#anchor),
    })
    if (this.#continuous) {
      this.#views.set(this.#index, this.#view)
      // Keep DOM order matching section order so container coordinates stay
      // a simple sum of preceding view sizes.
      const sorted = this.#sortedViews()
      const nextEntry = sorted[sorted.findIndex(([i]) => i === this.#index) + 1]
      if (nextEntry) this.#container.insertBefore(this.#view.element, nextEntry[1].element)
      else this.#container.append(this.#view.element)
    } else {
      this.#container.append(this.#view.element)
    }
    return this.#view
  }
  get #continuous() {
    // Horizontal scrolled flow only; vertical books and paginated flow always
    // fall back to the single-view path.
    return this.hasAttribute('continuous') && this.scrolled && !this.#vertical
  }
  #sortedViews() {
    return [...this.#views.entries()].sort(([a], [b]) => a - b)
  }
  // Pixel offset of a view's start within the scroll container.
  #getViewOffset(index) {
    let offset = 0
    for (const [i, view] of this.#sortedViews()) {
      if (i === index) return offset
      offset += view.element.getBoundingClientRect()[this.sideProp]
    }
    return offset
  }
  get #renderedStart() {
    return Math.abs(this.#container[this.scrollProp])
  }
  get #renderedEnd() {
    return this.#renderedStart + this.size
  }
  get #renderedViewSize() {
    let total = 0
    for (const [, view] of this.#views)
      total += view.element.getBoundingClientRect()[this.sideProp]
    return total
  }
  #destroyViewAt(index) {
    const view = this.#views.get(index)
    if (!view) return
    view.destroy()
    this.#container.removeChild(view.element)
    this.#views.delete(index)
    this.sections[index]?.unload?.()
  }
  // Load an adjacent section without changing the primary view.
  async #loadAdjacentSection(index) {
    if (!this.#continuous || this.#views.has(index) || !this.#canGoToIndex(index)) return
    const section = this.sections[index]
    if (!section || section.linear === 'no') return
    // Prepending above every loaded view: browsers suppress scroll anchoring
    // near scrollTop 0, so capture the position and compensate manually after
    // the new view has its final size.
    const firstIndex = this.#sortedViews()[0]?.[0]
    const isPrepend = firstIndex != null && index < firstIndex
    const startBefore = isPrepend ? this.#renderedStart : 0
    try {
      const src = await section.load()
      const view = new View({ container: this, onExpand: () => {} })
      this.#views.set(index, view)
      const sorted = this.#sortedViews()
      const nextEntry = sorted[sorted.findIndex(([i]) => i === index) + 1]
      if (nextEntry) this.#container.insertBefore(view.element, nextEntry[1].element)
      else this.#container.append(view.element)
      const afterLoad = doc => {
        if (doc.head) {
          const $styleBefore = doc.createElement('style')
          doc.head.prepend($styleBefore)
          const $style = doc.createElement('style')
          doc.head.append($style)
          this.#styleMap.set(doc, [$styleBefore, $style])
        }
        this.setStyles(this.#styles)
        this.dispatchEvent(new CustomEvent('load', { detail: { doc, index } }))
      }
      // Adjacent views reuse the primary's cached layout; running #beforeRender
      // again would clobber global state (dir attribute, container overflow).
      await view.load(src, afterLoad, () => this.#lastLayout)
      if (isPrepend) {
        const addedSize = view.element.getBoundingClientRect()[this.sideProp]
        const correction = startBefore + addedSize - this.#renderedStart
        if (Math.abs(correction) > 0.5) this.#container[this.scrollProp] += correction
      }
      this.dispatchEvent(new CustomEvent('create-overlayer', {
        detail: {
          doc: view.document, index,
          attach: overlayer => view.overlayer = overlayer,
        },
      }))
    } catch (e) {
      console.warn(e)
      console.warn(new Error(`Failed to load adjacent section ${index}`))
      this.#destroyViewAt(index)
    }
  }
  // Fill both directions until at least 5 viewport pages of buffer exist,
  // capped at 8 loaded sections.
  async #fillVisibleArea() {
    if (!this.#continuous || this.#filling) return
    this.#filling = true
    try {
      const minPages = 5
      const maxSections = 8
      let iterations = 0
      while (this.#views.size < maxSections && iterations++ < maxSections) {
        const pagesAhead = this.size > 0
          ? Math.floor((this.#renderedViewSize - this.#renderedEnd) / this.size) : 0
        if (pagesAhead >= minPages) break
        const lastIndex = this.#sortedViews().at(-1)?.[0]
        const next = lastIndex != null ? this.#adjacentIndex(1, lastIndex) : null
        if (next == null || this.#views.has(next)) break
        await this.#loadAdjacentSection(next)
        if (!this.#views.has(next)) break
      }
      iterations = 0
      while (this.#views.size < maxSections && iterations++ < maxSections) {
        const pagesBehind = this.size > 0
          ? Math.floor(this.#renderedStart / this.size) : 0
        if (pagesBehind >= minPages) break
        const firstIndex = this.#sortedViews()[0]?.[0]
        const prev = firstIndex != null ? this.#adjacentIndex(-1, firstIndex) : null
        if (prev == null || this.#views.has(prev)) break
        await this.#loadAdjacentSection(prev)
        if (!this.#views.has(prev)) break
      }
    } finally {
      this.#filling = false
    }
  }
  #checkBuffers() {
    if (this.#filling || this.size <= 0) return
    const minPages = 5
    const pagesAhead = Math.floor((this.#renderedViewSize - this.#renderedEnd) / this.size)
    const pagesBehind = Math.floor(this.#renderedStart / this.size)
    if (pagesAhead < minPages || pagesBehind < minPages) this.#fillVisibleArea()
  }
  // Unload views more than 10 pages past the viewport end. Never trims views
  // before the primary — removing those would shift the scroll position.
  #trimDistantViews() {
    const { size } = this
    if (!size) return
    const maxDistance = size * 10
    for (const [index] of this.#sortedViews()) {
      if (index <= this.#index) continue
      if (this.#getViewOffset(index) - this.#renderedEnd > maxDistance)
        this.#destroyViewAt(index)
    }
  }
  #beforeRender({ vertical, rtl }) {
    this.#vertical = vertical
    this.#rtl = rtl
    this.#top.classList.toggle('vertical', vertical)

    // set background to `doc` background
    // this is needed because the iframe does not fill the whole element
    this.#applyBackground()

    const { width, height } = this.#container.getBoundingClientRect()
    const size = vertical ? height : width

    const style = getComputedStyle(this.#top)
    const maxInlineSize = parseFloat(style.getPropertyValue('--_column-threshold')) || parseFloat(style.getPropertyValue('--_max-inline-size'))
    const maxColumnCount = parseInt(style.getPropertyValue('--_max-column-count'))
    const margin = parseFloat(style.getPropertyValue('--_top-margin'))
    this.#margin = margin

    const g = parseFloat(style.getPropertyValue('--_gap')) / 100
    // The gap will be a percentage of the #container, not the whole view.
    // This means the outer padding will be bigger than the column gap. Let
    // `a` be the gap percentage. The actual percentage for the column gap
    // will be (1 - a) * a. Let us call this `b`.
    //
    // To make them the same, we start by shrinking the outer padding
    // setting to `b`, but keep the column gap setting the same at `a`. Then
    // the actual size for the column gap will be (1 - b) * a. Repeating the
    // process again and again, we get the sequence
    //     x₁ = (1 - b) * a
    //     x₂ = (1 - x₁) * a
    //     ...
    // which converges to x = (1 - x) * a. Solving for x, x = a / (1 + a).
    // So to make the spacing even, we must shrink the outer padding with
    //     f(x) = x / (1 + x).
    // But we want to keep the outer padding, and make the inner gap bigger.
    // So we apply the inverse, f⁻¹ = -x / (x - 1) to the column gap.
    const gap = -g / (g - 1) * size

    const topMargin = parseFloat(style.getPropertyValue('--_top-margin'))
    const bottomMargin = parseFloat(style.getPropertyValue('--_bottom-margin'))

    const flow = this.getAttribute('flow')
    if (flow === 'scrolled') {
      this.#container.style.overflowX = 'auto'
      this.#container.style.overflowY = 'auto'
    } else if (vertical) {
      this.#container.style.overflowX = 'hidden'
      this.#container.style.overflowY = 'auto'
    } else {
      this.#container.style.overflowX = 'auto'
      this.#container.style.overflowY = 'hidden'
    }
    if (flow === 'scrolled') {
      // FIXME: vertical-rl only, not -lr
      this.setAttribute('dir', vertical ? 'rtl' : 'ltr')
      this.#top.style.padding = '0'
      const columnWidth = maxInlineSize

      this.heads = null
      this.feet = null
      this.#header.replaceChildren()
      this.#footer.replaceChildren()

      this.#lastLayout = { flow, margin, gap, columnWidth, topMargin, bottomMargin }
      return this.#lastLayout
    }

    const divisor = maxColumnCount == 0
      ? Math.min(2, Math.ceil(size / maxInlineSize))
      : maxColumnCount

    // Page-width cap and horizontal padding arrive as --_max-inline-size. The
    // paginated layout always fills the container (page advance = container
    // size), so narrow the content by widening the column gap and side padding
    // symmetrically — page alignment is preserved because column advance
    // (columnWidth + gapEff) still equals size / divisor.
    const inset = Math.max(0, Math.min(size - 320, size - maxInlineSize))
    const gapEff = gap + inset / divisor
    const columnWidth = (size / divisor) - gapEff
    this.setAttribute('dir', rtl ? 'rtl' : 'ltr')

    // One shared marginal across the whole page, centered — not one per column.
    const heads = makeMarginals(1, 'head')
    const feet = makeMarginals(1, 'foot')
    this.heads = heads.map(el => el.children[0])
    this.feet = feet.map(el => el.children[0])
    this.#header.replaceChildren(...heads)
    this.#footer.replaceChildren(...feet)
    // fresh marginal elements lose their text on every relayout
    for (const el of this.heads) el.textContent = this.#headerText
    for (const el of this.feet) el.textContent = this.#footerText

    this.#lastLayout = { height, width, margin, gap: gapEff, columnWidth, topMargin, bottomMargin }
    return this.#lastLayout
  }
  // Header shows the book title, footer the current chapter; only visible in
  // paginated flow (CSS hides them in scrolled flow).
  setMarginals({ header, footer }) {
    if (header !== undefined) this.#headerText = header
    if (footer !== undefined) this.#footerText = footer
    if (this.heads) for (const el of this.heads) el.textContent = this.#headerText
    if (this.feet) for (const el of this.feet) el.textContent = this.#footerText
  }
  render() {
    if (!this.#view) return
    // Leaving continuous mode (flow change, vertical writing, attribute off)
    // must not leave stale adjacent views in the container — but the primary
    // view IS #view; destroying it blanks the page and the next removeChild
    // in #createView throws on the already-removed element.
    if (!this.#continuous && this.#views.size) {
      for (const [i] of [...this.#views])
        if (i !== this.#index) this.#destroyViewAt(i)
      this.#views.clear()
    }
    const layout = this.#beforeRender({
      vertical: this.#vertical,
      rtl: this.#rtl,
    })
    if (this.#continuous) {
      // flow may have switched to scrolled after the attribute was set, in
      // which case the primary view never got registered.
      if (this.#view && !this.#views.has(this.#index)) this.#views.set(this.#index, this.#view)
      for (const [, view] of this.#views) view.render(layout)
    }
    else this.#view.render(layout)
    this.scrollToAnchor(this.#anchor)
  }
  get scrolled() {
    return this.getAttribute('flow') === 'scrolled'
  }
  get scrollProp() {
    const { scrolled } = this
    return this.#vertical ? (scrolled ? 'scrollLeft' : 'scrollTop')
      : scrolled ? 'scrollTop' : 'scrollLeft'
  }
  get sideProp() {
    const { scrolled } = this
    return this.#vertical ? (scrolled ? 'width' : 'height')
      : scrolled ? 'height' : 'width'
  }
  get vertical() {
    return this.#vertical
  }
  get size() {
    return this.#container.getBoundingClientRect()[this.sideProp]
  }
  get viewSize() {
    return this.#view.element.getBoundingClientRect()[this.sideProp]
  }
  get start() {
    const rendered = Math.abs(this.#container[this.scrollProp])
    // In continuous mode positions are chapter-relative (to the primary view)
    // so anchors and fractions keep their single-view meaning.
    return this.#continuous ? rendered - this.#getViewOffset(this.#index) : rendered
  }
  get end() {
    return this.start + this.size
  }
  get page() {
    return Math.floor(((this.start + this.end) / 2) / this.size)
  }
  get pages() {
    return Math.round(this.viewSize / this.size)
  }
  scrollBy(dx, dy) {
    const element = this.#container
    const prop = this.scrollProp
    const horizontal = prop === 'scrollLeft'
    const delta = horizontal ? dx : dy
    if (horizontal) element.scrollBy({ left: delta, top: 0, behavior: 'auto' })
    else element.scrollBy({ left: 0, top: delta, behavior: 'auto' })
  }
  snap(vx, vy, touchState) {
    if (this.#isSnapping) return
    
    const state = touchState ?? this.#touchState
    const velocity = this.#vertical ? vy : vx
    const { pages, size } = this
    if (!pages || size === 0) return

    const element = this.#container
    const { scrollProp } = this
    const isHorizontal = scrollProp === 'scrollLeft'
    
    // Stop native momentum scrolling immediately
    const currentScrollPos = element[scrollProp]
    const overflowProp = isHorizontal ? 'overflowX' : 'overflowY'
    const prevOverflow = element.style[overflowProp]
    element.style[overflowProp] = 'hidden'
    element[scrollProp] = currentScrollPos
    
    // Calculate current position and target page
    const currentOffset = Math.abs(currentScrollPos)
    const currentPage = Math.round(currentOffset / size)
    
    // Determine target page based on velocity
    const velocityThreshold = 0.3  // Higher threshold to reduce accidental triggers
    let targetPage = currentPage
    if (Math.abs(velocity) > velocityThreshold) {
      targetPage += velocity > 0 ? 1 : -1
    }
    
    // Single page limit (keep existing feature)
    const originPage = state?.startPage ?? currentPage
    if (!this.scrolled) {
      const delta = targetPage - originPage
      if (delta > 1) targetPage = originPage + 1
      else if (delta < -1) targetPage = originPage - 1
    }
    
    // Boundary limits
    targetPage = Math.max(0, Math.min(pages - 1, targetPage))
    
    // Calculate animation duration based on distance
    const targetOffset = targetPage * size
    const distance = Math.abs(targetOffset - currentOffset)
    const duration = Math.max(200, Math.min(300, 250 * (distance / (size || 1))))

    const pageArg = this.#rtl ? -targetPage : targetPage
    this.#isSnapping = true
    
    return this.#scrollToPage(pageArg, 'snap', { animate: true, duration })
      .then(() => {
        // Handle chapter boundaries (keep existing feature)
        const dir = targetPage <= 0 ? -1 : targetPage >= pages - 1 ? 1 : null
        if (dir) return this.#goTo({
          index: this.#adjacentIndex(dir),
          anchor: dir < 0 ? () => 1 : () => 0,
        })
      })
      .finally(() => {
        this.#isSnapping = false
        // Restore overflow after snap is complete
        element.style[overflowProp] = prevOverflow
      })
  }
  #onTouchStart(e) {
    const touch = e.changedTouches[0]
    const scrollProp = this.scrollProp
    this.#touchState = {
      x: touch?.screenX, y: touch?.screenY,
      t: e.timeStamp,
      vx: 0, vy: 0,
      pinched: false,
      direction: 'none',
      startTouch: {
        x: e.touches[0].screenX,
        y: e.touches[0].screenY,
      },
      delta: { x: 0, y: 0 },
      startScroll: this.#container[scrollProp],
      startPage: this.page,
      lockedOffset: null,
      axis: scrollProp,
    }
    this.dispatchEvent(new CustomEvent('doctouchstart', {
      detail: {
        touch: e.changedTouches[0],
        touchState: this.#touchState,
      },
      bubbles: true,
      composed: true
    }))
  }
  #onTouchMove(e) {
    if (window.getSelection()?.toString()) return

    const touch = e.changedTouches[0]
    const state = this.#touchState
    if (!state) return

    const deltaX = touch.screenX - state.startTouch.x
    const deltaY = touch.screenY - state.startTouch.y

    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    state.delta.x = deltaX
    state.delta.y = deltaY



    const threshold = 5

    const notHorizontal = state.direction === 'horizontal' && absDeltaY > absDeltaX;
    const notVertical = state.direction === 'vertical' && absDeltaX > absDeltaY;

    if (state.direction !== 'none' || (notHorizontal && notVertical)) {
      if (absDeltaX < threshold && absDeltaY < threshold) return;
    }

    if ((absDeltaX > threshold || absDeltaY > threshold) && state.direction === 'none') {
      if (absDeltaX > absDeltaY) {
        state.direction = 'horizontal'
      } else {
        state.direction = 'vertical'
        if (this.scrollProp === 'scrollLeft' && state.lockedOffset == null)
          state.lockedOffset = state.startScroll ?? this.#container.scrollLeft
      }
    }

    const axisProp = this.scrollProp
    state.axis = axisProp
    const horizontalAxis = axisProp === 'scrollLeft'
    const verticalAxis = axisProp === 'scrollTop'
    const horizontalDrag = state.direction === 'horizontal'
    const verticalDrag = state.direction === 'vertical'

    const forwarded = new CustomEvent('doctouchmove', {
      detail: {
        touch,
        touchState: state,
      },
      preventDefault: () => e.preventDefault(),
      bubbles: true,
      composed: true
    })
    this.dispatchEvent(forwarded)

    if (state.pinched) return
    state.pinched = globalThis.visualViewport.scale > 1
    if (state.pinched) return

    if (e.touches.length > 1) {
      if (this.#touchScrolled) e.preventDefault()
      return
    }

    const dt = e.timeStamp - state.t || 16.7
    const stepX = state.x - touch.screenX
    const stepY = state.y - touch.screenY
    state.x = touch.screenX
    state.y = touch.screenY
    state.t = e.timeStamp
    state.vx = stepX / dt
    state.vy = stepY / dt

    if (this.scrolled) return

    if (verticalDrag && horizontalAxis) {
      e.preventDefault()
      // Lock horizontal position during vertical drag (direction locking)
      if (state.lockedOffset == null)
        state.lockedOffset = state.startScroll ?? this.#container.scrollLeft
      this.#container.scrollLeft = state.lockedOffset
      return
    }

    if (verticalDrag && verticalAxis) {
      this.#touchScrolled = true
      return
    }

    if (horizontalDrag && horizontalAxis) {
      this.#touchScrolled = true
      // rely on native scrolling for horizontal paging
    }
  }
  #onTouchEnd(e) {
    const state = this.#touchState
    this.dispatchEvent(new CustomEvent('doctouchend', {
      detail: {
        touch: e.changedTouches[0],
        touchState: state,
      },
      bubbles: true,
      composed: true
    }))

    this.#touchScrolled = false
    if (this.scrolled) {
      this.#touchState = null
      return
    }

    const verticalLocked = state?.direction === 'vertical'
      && state.axis === 'scrollLeft'
      && state.lockedOffset != null

    if (verticalLocked) {
      // Restore original horizontal position and skip snapping to avoid accidental page turns
      this.#container.scrollLeft = state.lockedOffset
      this.#touchState = null
      if (this.#pendingRelocate) {
        const detail = this.#pendingRelocate
        this.#pendingRelocate = null
        this.dispatchEvent(new CustomEvent('relocate', { detail }))
      }
      return
    }


    // XXX: Firefox seems to report scale as 1... sometimes...?
    // at this point I'm basically throwing `requestAnimationFrame` at
    // anything that doesn't work
    requestAnimationFrame(() => {
      if (globalThis.visualViewport.scale === 1 && state)
        Promise.resolve(this.snap(state.vx, state.vy, state))
          .finally(() => { this.#touchState = null })
      else this.#touchState = null
    })
  }
  // allows one to process rects as if they were LTR and horizontal
  #getRectMapper() {
    if (this.scrolled) {
      const size = this.viewSize
      const margin = this.#margin
      return this.#vertical
        ? ({ left, right }) =>
          ({ left: size - right - margin, right: size - left - margin })
        : ({ top, bottom }) => ({ left: top + margin, right: bottom + margin })
    }
    const pxSize = this.pages * this.size
    return this.#rtl
      ? ({ left, right }) =>
        ({ left: pxSize - right, right: pxSize - left })
      : this.#vertical
        ? ({ top, bottom }) => ({ left: top, right: bottom })
        : f => f
  }
  async #scrollToRect(rect, reason) {
    if (this.scrolled) {
      // bookdock: land range anchors ~28% below the viewport top so preceding
      // context stays visible (search results, notes, bookmarks)
      const contextOffset = this.size * 0.28
      const offset = this.#getRectMapper()(rect).left - this.#margin - contextOffset
        + (this.#continuous ? this.#getViewOffset(this.#index) : 0)
      return this.#scrollTo(Math.max(0, offset), reason)
    }
    const mappedRect = this.#getRectMapper()(rect)
    const left = mappedRect.left
    const pageIndex = Math.floor(left / this.size)
    const pageStart = pageIndex * this.size
    const pageEnd = pageStart + this.size
    const nudgedLeft = Math.min(left + this.#margin / 2, pageEnd - 1)
    const normalizedLeft = Math.max(pageStart, nudgedLeft)
    return this.#scrollToPage(Math.floor(normalizedLeft / this.size) + (this.#rtl ? -1 : 1), reason)
  }
  async #scrollTo(offset, reason, smooth) {
    const element = this.#container
    const { scrollProp, size } = this
    this.#ignoreNativeScroll = true
    
    const opts = typeof smooth === 'object' ? smooth ?? {} : {}
    const shouldAnimate = opts.animate ?? (reason === 'snap' || smooth === true)
    const easing = opts.easing ?? easeOutSine
    
    const finish = () => {
      this.#afterScroll(reason)
      this.#ignoreNativeScroll = false
    }

    // If already at target position
    if (Math.abs(element[scrollProp] - offset) < 1) {
      finish()
      return
    }

    // FIXME: vertical-rl only, not -lr
    if (this.scrolled && this.#vertical) offset = -offset

    const useAnimation = shouldAnimate && this.hasAttribute('animated')

    if (useAnimation) {
      const distance = Math.abs(element[scrollProp] - offset)
      const duration = opts.duration ?? Math.max(200, Math.min(300, 250 * (distance / (size || 1))))

      this.#justAnchored = true

      return animate(
        element[scrollProp],
        offset,
        duration,
        easing,
        x => element[scrollProp] = x,
      ).then(() => {
        // Ensure exact position
        element[scrollProp] = offset
        finish()
      }).catch(() => {
        this.#ignoreNativeScroll = false
      })
    } else {
      element[scrollProp] = offset
      finish()
    }
  }
  async #scrollToPage(page, reason, smooth) {
    const offset = this.size * (this.#rtl ? -page : page)
    return this.#scrollTo(offset, reason, smooth)
  }
  async scrollToAnchor(anchor, select) {
    this.#anchor = anchor
    const rects = uncollapse(anchor)?.getClientRects?.()
    // if anchor is an element or a range
    if (rects) {
      // when the start of the range is immediately after a hyphen in the
      // previous column, there is an extra zero width rect in that column
      const rect = Array.from(rects)
        .find(r => r.width > 0 && r.height > 0) || rects[0]
      if (!rect) return
      await this.#scrollToRect(rect, 'anchor')
      if (select) this.#selectAnchor()
      return
    }
    // if anchor is a fraction
    if (this.scrolled) {
      await this.#scrollTo((this.#continuous ? this.#getViewOffset(this.#index) : 0)
        + anchor * this.viewSize, 'anchor')
      return
    }
    const { pages } = this
    if (!pages) return
    const textPages = pages - 2
    const newPage = Math.round(anchor * (textPages - 1))
    await this.#scrollToPage(newPage + 1, 'anchor')
  }
  #selectAnchor() {
    const { defaultView } = this.#view.document
    if (this.#anchor.startContainer) {
      const sel = defaultView.getSelection()
      sel.removeAllRanges()
      sel.addRange(this.#anchor)
    }
  }
  #getVisibleRange() {
    if (this.#continuous) {
      // Several sections can share the viewport at a boundary; the chapter the
      // reader is actually reading is the one covering the viewport centre.
      // Keep the first overlapping range as a fallback for the very start/end
      // of the book where no loaded view covers the centre.
      const center = this.#renderedStart + this.size / 2
      let fallback
      for (const [index, view] of this.#sortedViews()) {
        if (!view.document) continue
        const off = this.#getViewOffset(index)
        const vSize = view.element.getBoundingClientRect()[this.sideProp]
        if (off + vSize <= this.#renderedStart || off >= this.#renderedEnd) continue
        const range = getVisibleRange(view.document,
          this.#renderedStart - off + this.#margin,
          this.#renderedEnd - off - this.#margin, this.#getRectMapper())
        if (!range || range.collapsed) continue
        if (center >= off && center < off + vSize) return { range, index }
        fallback ??= { range, index }
      }
      return fallback
    }
    if (this.scrolled) return getVisibleRange(this.#view.document,
      this.start + this.#margin, this.end - this.#margin, this.#getRectMapper())
    const size = this.#rtl ? -this.size : this.size
    return getVisibleRange(this.#view.document,
      this.start - size, this.end - size, this.#getRectMapper())
  }
  #afterScroll(reason) {
    if (this.#continuous) {
      const result = this.#getVisibleRange()
      // The primary chapter follows the viewport centre as scrolling crosses
      // section boundaries; relocate's index therefore changes naturally.
      if (result && result.index !== this.#index && this.#views.has(result.index)) {
        this.#index = result.index
        this.#view = this.#views.get(result.index)
        this.#trimDistantViews()
      }
      const index = result?.index ?? this.#index
      const indexView = this.#views.get(index)
      const viewSize = indexView
        ? indexView.element.getBoundingClientRect()[this.sideProp] : 0
      // Chapter-internal fraction: identical semantics to the single-view
      // fraction anchor, so re-anchoring after relayout restores proportionally.
      const fraction = viewSize > 0
        ? Math.max(0, Math.min(1,
          (this.#renderedStart - this.#getViewOffset(index)) / viewSize))
        : 0
      if (reason !== 'anchor') this.#anchor = fraction
      else this.#justAnchored = true

      const detail = { reason, range: result?.range, index, fraction }
      this.#pendingRelocate = null
      this.dispatchEvent(new CustomEvent('relocate', { detail }))
      return
    }
    const range = this.#getVisibleRange()
    // don't set new anchor if relocation was to scroll to anchor
    // Keep the anchor as a plain fraction: re-anchoring to a Range after a relayout
    // (font/margin change) is unreliable here and can land at the section start,
    // while a fraction rescales proportionally to the new layout.
    if (reason !== 'anchor') {
      if (this.scrolled)
        this.#anchor = this.viewSize > 0 ? this.start / this.viewSize : range
      else if (this.pages > 2)
        this.#anchor = (this.page - 1) / (this.pages - 2)
      else this.#anchor = range
    }
    else this.#justAnchored = true

    const index = this.#index
    const detail = { reason, range, index }
    if (this.scrolled) detail.fraction = this.start / this.viewSize
    else if (this.pages > 0) {
      const { page, pages } = this
      // this.#header.style.visibility = page > 1 ? 'visible' : 'hidden'
      detail.fraction = (page - 1) / (pages - 2)
      detail.size = 1 / (pages - 2)
    }
    if (!this.scrolled && reason === 'scroll' && (this.#touchState || this.#touchScrolled)) {
      this.#pendingRelocate = detail
      return
    }

    this.#pendingRelocate = null
    this.dispatchEvent(new CustomEvent('relocate', { detail }))
  }
  // Wheel dispatch: scrolled flow uses snap-turn (chapter-boundary crossing);
  // paginated flow turns whole pages. Accumulation + cooldown filters trackpad
  // noise so one gesture flips exactly one page/chapter.
  #onWheel(e) {
    if (!this.#view) return
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.size : 1
    const delta = e.deltaY * unit
    if (!delta) return
    if (this.scrolled) return this.#onWheelSnap(delta)
    this.#onWheelPage(delta)
  }
  // "snap" continuous scroll: the section is still rendered on its own, but
  // wheeling past the chapter end/start accumulates delta and turns to the
  // adjacent section once it crosses the threshold (legacy TxtRenderer parity).
  #onWheelSnap(delta) {
    // Chapter boundaries don't exist in continuous mode, so snap-turn must
    // never trigger there even if both attributes are present.
    if (!this.#snapTurn || this.#continuous || this.#snapNavigating) return
    const now = Date.now()
    if (now < this.#snapCooldownUntil) return
    const atEnd = this.viewSize - this.end <= 2
    const atStart = this.start <= 2
    if ((delta > 0 && !atEnd) || (delta < 0 && !atStart)) {
      this.#wheelAccum = 0
      return
    }
    this.#wheelAccum = Math.sign(delta) === Math.sign(this.#wheelAccum)
      ? this.#wheelAccum + delta : delta
    if (Math.abs(this.#wheelAccum) < Paginator.SNAP_DELTA_THRESHOLD) return
    const dir = this.#wheelAccum > 0 ? 1 : -1
    this.#wheelAccum = 0
    const index = this.#adjacentIndex(dir)
    if (index == null) return
    this.#snapNavigating = true
    this.#snapCooldownUntil = now + Paginator.SNAP_COOLDOWN
    this.#goTo({ index, anchor: dir > 0 ? () => 0 : () => 1 })
      .catch(() => {})
      .finally(() => { this.#snapNavigating = false })
  }
  #onWheelPage(delta) {
    if (this.#locked) return
    const now = Date.now()
    if (now < this.#pageWheelCooldownUntil) return
    this.#pageWheelAccum = Math.sign(delta) === Math.sign(this.#pageWheelAccum)
      ? this.#pageWheelAccum + delta : delta
    if (Math.abs(this.#pageWheelAccum) < Paginator.PAGE_WHEEL_THRESHOLD) return
    const dir = this.#pageWheelAccum > 0 ? 1 : -1
    this.#pageWheelAccum = 0
    this.#pageWheelCooldownUntil = now + Paginator.PAGE_WHEEL_COOLDOWN
    this.#turnPage(dir)
  }
  // Key events inside the iframe never reach the top window, so page-mode
  // keyboard turns are handled here.
  #onDocKey(e) {
    if (this.scrolled) return
    const target = e.target
    if (target && (target.isContentEditable
      || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault()
      this.next()
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault()
      this.prev()
    }
  }
  async #display(promise) {
    const { index, src, anchor, onLoad, select } = await promise
    this.#index = index
    if (src) {
      const view = this.#createView()
      const afterLoad = doc => {
        if (doc.head) {
          const $styleBefore = doc.createElement('style')
          doc.head.prepend($styleBefore)
          const $style = doc.createElement('style')
          doc.head.append($style)
          this.#styleMap.set(doc, [$styleBefore, $style])
        }
        onLoad?.({ doc, index })
      }
      const beforeRender = this.#beforeRender.bind(this)
      await view.load(src, afterLoad, beforeRender)
      this.dispatchEvent(new CustomEvent('create-overlayer', {
        detail: {
          doc: view.document, index,
          attach: overlayer => view.overlayer = overlayer,
        },
      }))
      this.#view = view
    }
    await this.scrollToAnchor((typeof anchor === 'function'
      ? anchor(this.#view.document) : anchor) ?? 0, select)
  }
  #canGoToIndex(index) {
    return index >= 0 && index <= this.sections.length - 1
  }
  async #goTo({ index, anchor, select }) {
    if (this.#continuous) {
      // Target already rendered: reuse the view, just switch primary + scroll.
      if (index !== this.#index && this.#views.has(index)) {
        this.#index = index
        this.#view = this.#views.get(index)
        const resolvedAnchor = (typeof anchor === 'function'
          ? anchor(this.#view.document) : anchor) ?? 0
        await this.scrollToAnchor(resolvedAnchor, select)
        this.#trimDistantViews()
        await this.#fillVisibleArea()
        return
      }
      if (index !== this.#index) {
        // Far jump: keep only the target's neighbourhood; distant views would
        // be wrong-side buffers around the new position.
        const keep = new Set([index])
        for (const [i] of this.#views) if (Math.abs(i - index) <= 2) keep.add(i)
        for (const [i] of [...this.#views]) if (!keep.has(i)) this.#destroyViewAt(i)
        const onLoad = detail => {
          this.setStyles(this.#styles)
          this.dispatchEvent(new CustomEvent('load', { detail }))
        }
        await this.#display(Promise.resolve(this.sections[index].load())
          .then(src => ({ index, src, anchor, onLoad, select }))
          .catch(e => {
            console.warn(e)
            console.warn(new Error(`Failed to load section ${index}`))
            return {}
          }))
        await this.#fillVisibleArea()
        return
      }
    }
    if (index === this.#index) {
      await this.#display({ index, anchor, select })
      if (this.#continuous) await this.#fillVisibleArea()
    }
    else {
      const oldIndex = this.#index
      const onLoad = detail => {
        this.sections[oldIndex]?.unload?.()
        this.setStyles(this.#styles)
        this.dispatchEvent(new CustomEvent('load', { detail }))
      }
      await this.#display(Promise.resolve(this.sections[index].load())
        .then(src => ({ index, src, anchor, onLoad, select }))
        .catch(e => {
          console.warn(e)
          console.warn(new Error(`Failed to load section ${index}`))
          return {}
        }))
    }
  }
  async goTo(target) {
    if (this.#locked) return
    const resolved = await target
    if (this.#canGoToIndex(resolved.index)) return this.#goTo(resolved)
  }
  #scrollPrev(distance) {
    if (!this.#view) return true
    if (this.scrolled) {
      if (this.#continuous) {
        if (this.#renderedStart > 0) return this.#scrollTo(
          Math.max(0, this.#renderedStart - (distance ?? this.size)), null, { animate: true })
        return true
      }
      if (this.start > 0) return this.#scrollTo(
        Math.max(0, this.start - (distance ?? this.size)), null, { animate: true })
      return true
    }
    if (this.atStart) return
    const page = this.page - 1
    return this.#scrollToPage(page, 'page', { animate: true }).then(() => page <= 0)
  }
  #scrollNext(distance) {
    if (!this.#view) return true
    if (this.scrolled) {
      if (this.#continuous) {
        if (this.#renderedViewSize - this.#renderedEnd > 2) return this.#scrollTo(
          Math.min(this.#renderedViewSize,
            distance ? this.#renderedStart + distance : this.#renderedEnd), null, { animate: true })
        return true
      }
      if (this.viewSize - this.end > 2) return this.#scrollTo(
        Math.min(this.viewSize, distance ? this.start + distance : this.end), null, { animate: true })
      return true
    }
    if (this.atEnd) return
    const page = this.page + 1
    const pages = this.pages
    return this.#scrollToPage(page, 'page', { animate: true }).then(() => page >= pages - 1)
  }
  get atStart() {
    return this.#adjacentIndex(-1) == null && this.page <= 1
  }
  get atEnd() {
    return this.#adjacentIndex(1) == null && this.page >= this.pages - 2
  }
  #adjacentIndex(dir, fromIndex) {
    if (fromIndex === undefined) fromIndex = this.#index
    for (let index = fromIndex + dir; this.#canGoToIndex(index); index += dir)
      if (this.sections[index]?.linear !== 'no') return index
  }
  async #turnPage(dir, distance) {
    // if (this.#locked) return
    this.#locked = true
    try {
      const prev = dir === -1
      const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))

      if (shouldGo) await this.#goTo({
        index: this.#adjacentIndex(dir),
        anchor: prev ? () => 1 : () => 0,
      })
      if (shouldGo || !this.hasAttribute('animated')) await wait(100)
    } finally {
      // a stuck lock silently kills every later goTo — always release
      this.#locked = false
    }
  }
  prev(distance) {
    return this.#turnPage(-1, distance)
  }
  next(distance) {
    return this.#turnPage(1, distance)
  }
  prevSection() {
    return this.goTo({ index: this.#adjacentIndex(-1) })
  }
  nextSection() {
    return this.goTo({ index: this.#adjacentIndex(1) })
  }
  firstSection() {
    const index = this.sections.findIndex(section => section.linear !== 'no')
    return this.goTo({ index })
  }
  lastSection() {
    const index = this.sections.findLastIndex(section => section.linear !== 'no')
    return this.goTo({ index })
  }
  getContents() {
    if (this.#continuous && this.#views.size)
      return this.#sortedViews().map(([index, view]) => ({
        index,
        overlayer: view.overlayer,
        doc: view.document,
      }))
    if (this.#view) return [{
      index: this.#index,
      overlayer: this.#view.overlayer,
      doc: this.#view.document,
    }]
    return []
  }
  setStyles(styles) {
    this.#styles = styles
    // Continuous mode has one style slot per loaded document.
    const views = this.#continuous && this.#views.size
      ? [...this.#views.values()] : [this.#view]
    for (const view of views) {
      const $$styles = this.#styleMap.get(view?.document)
      if (!$$styles) continue
      const [$beforeStyle, $style] = $$styles
      if (Array.isArray(styles)) {
        const [beforeStyle, style] = styles
        $beforeStyle.textContent = beforeStyle
        $style.textContent = style
      } else $style.textContent = styles
    }

    this.#applyBackground()

    // needed because the resize observer doesn't work in Firefox
    for (const view of views)
      view?.document?.fonts?.ready?.then(() => view.expand())
  }
  get writingMode() {
    return this.#view?.writingMode
  }
  destroy() {
    this.#observer.unobserve(this)
    // #destroyViewAt already destroys the view and unloads the section, so
    // skip the single-view teardown for indices the map covered.
    const primaryInMap = this.#views.has(this.#index)
    for (const [i] of [...this.#views]) this.#destroyViewAt(i)
    if (!primaryInMap) {
      this.#view.destroy()
      this.sections[this.#index]?.unload?.()
    }
    this.#view = null
    this.#mediaQuery.removeEventListener('change', this.#mediaQueryListener)
    if (this.#pendingScrollFrame) {
      cancelAnimationFrame(this.#pendingScrollFrame)
      this.#pendingScrollFrame = null
    }
    if (this.#pendingScrollTimer) {
      clearTimeout(this.#pendingScrollTimer)
      this.#pendingScrollTimer = null
    }
    this.#pendingRelocate = null
  }
}

customElements.define('foliate-paginator', Paginator)
