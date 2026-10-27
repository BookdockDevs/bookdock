import type { EpubEditorDocument, EpubEditorTocEntry } from './epub-editor-draft'

const themeStyleId = 'bookdock-editor-theme'
const contrastStyleId = 'bookdock-editor-background-contrast'
const presentationAttributes = new WeakMap<Element, Map<string, { original: string | null; rendered: string }>>()
const presentationText = new WeakMap<Element, { original: string; rendered: string }>()
const implicitTableBodies = new WeakSet<Element>()

export function markEpubImplicitTableBodies(document: Document, markup: string): void {
  const source = new DOMParser().parseFromString(markup, 'application/xhtml+xml')
  if (source.querySelector('parsererror')) return
  const sourceTables = Array.from(source.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'table'))
  const liveTables = Array.from(document.body.querySelectorAll('table'))
  if (sourceTables.length !== liveTables.length) return
  sourceTables.forEach((table, index) => {
    const children = Array.from(table.children)
    if (!children.some((child) => child.localName === 'tr') || children.some((child) => child.localName === 'tbody')) return
    for (const child of Array.from(liveTables[index]!.children)) {
      if (child.localName === 'tbody' && child.attributes.length === 0) implicitTableBodies.add(child)
    }
  })
}

export function setEpubPresentationText(element: Element, rendered: string): void {
  const original = element.textContent ?? ''
  if (original === rendered) return
  presentationText.set(element, { original, rendered })
  element.textContent = rendered
}

export function setEpubPresentationAttribute(element: Element, name: string, rendered: string): void {
  const original = element.getAttribute(name)
  if (original === rendered) return
  let attributes = presentationAttributes.get(element)
  if (!attributes) presentationAttributes.set(element, attributes = new Map())
  attributes.set(name, { original, rendered })
  if (name === 'xlink:href') element.setAttributeNS('http://www.w3.org/1999/xlink', name, rendered)
  else element.setAttribute(name, rendered)
}

export function clearEpubPresentation(body: Element): void {
  for (const element of [body, ...body.querySelectorAll('*')]) {
    const text = presentationText.get(element)
    if (text && element.textContent === text.rendered) element.textContent = text.original
    presentationText.delete(element)
    for (const [name, value] of presentationAttributes.get(element) ?? []) {
      if (element.getAttribute(name) !== value.rendered) continue
      if (value.original === null) element.removeAttribute(name)
      else if (name === 'xlink:href') element.setAttributeNS('http://www.w3.org/1999/xlink', name, value.original)
      else element.setAttribute(name, value.original)
    }
    presentationAttributes.delete(element)
  }
}

function originalBody(body: Element): Element {
  const clone = body.cloneNode(true) as Element
  const originals = [body, ...body.querySelectorAll('*')]
  const copies = [clone, ...clone.querySelectorAll('*')]
  originals.forEach((element, index) => {
    const copy = copies[index]
    if (!copy) return
    const text = presentationText.get(element)
    if (text && copy.textContent === text.rendered) copy.textContent = text.original
    for (const [name, value] of presentationAttributes.get(element) ?? []) {
      if (copy.getAttribute(name) === value.rendered) {
        if (value.original === null) copy.removeAttribute(name)
        else if (name === 'xlink:href') copy.setAttributeNS('http://www.w3.org/1999/xlink', name, value.original)
        else copy.setAttribute(name, value.original)
      }
    }
    if (implicitTableBodies.has(element) && element.attributes.length === 0 && copy.parentNode) copy.replaceWith(...Array.from(copy.childNodes))
  })
  return clone
}
const commonDarkColors = new Set(['#000', '#000000', 'black', '#111', '#111111', 'rgb(17,17,17)', '#222', '#222222', 'rgb(34,34,34)', '#333', '#333333', 'rgb(51,51,51)', 'rgb(0,0,0)'])
const commonLightColors = new Set(['#fff', '#ffffff', 'white', 'rgb(255,255,255)'])

function themeColor(value: string): 'dark' | 'light' | null {
  const normalized = value.toLowerCase().replace(/\s+/g, '')
  if (commonDarkColors.has(normalized)) return 'dark'
  if (commonLightColors.has(normalized)) return 'light'
  return null
}

function hasExplicitBackground(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = (current as HTMLElement).style
    if (style?.background || style?.backgroundColor || style?.backgroundImage) return true
  }
  return false
}

function cssString(value: string): string {
  return `"${Array.from(value, (character) => {
    const code = character.codePointAt(0)!
    return character === '"' || character === '\\' ? `\\${character}` : character === '<' || code === 0 || code < 0x20 || code === 0x7f ? `\\${code.toString(16)} ` : character
  }).join('')}"`
}

function inlineColorRules(document: Document, dark: boolean): string {
  const body = document.body
  if (!body) return ''
  const selectors = new Set([...body.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
    if (element.closest('a') || hasExplicitBackground(element)) return []
    const sourceColor = themeColor(element.style.color)
    if (!sourceColor || (dark ? sourceColor !== 'dark' : sourceColor !== 'light') || element.style.getPropertyPriority('color') === 'important') return []
    const styleAttribute = element.getAttribute('style')
    return styleAttribute ? [`body [style=${cssString(styleAttribute)}]:not(a):not(a *):not([style*="background" i]):not([style*="background" i] *)`] : []
  }))
  if (!selectors.size) return ''
  return `${[...selectors].join(',')}{color:${dark ? '#e7e5e4' : '#1c1917'}!important}`
}

function epubThemeCss(dark: boolean, document?: Document): string {
  const background = dark ? '#1c1917' : '#fff'
  const foreground = dark ? '#e7e5e4' : '#1c1917'
  const link = dark ? '#93c5fd' : '#1d4ed8'
  const selection = dark ? 'rgba(96, 165, 250, .35)' : 'rgba(59, 130, 246, .25)'
  const reprojectedColors = document ? inlineColorRules(document, dark) : ''
  return `:root{color-scheme:${dark ? 'dark' : 'light'}}html{background:${background}}body{color:${foreground};font:16px/1.8 Georgia,"Times New Roman",serif;margin:24px auto;padding:0 16px;caret-color:${foreground}}html body{box-sizing:border-box;max-width:min(100%,52rem);min-height:calc(100vh - 48px);margin-inline:auto!important}a{color:${link}}${reprojectedColors}::selection{background:${selection}}img{max-width:100%;height:auto}svg{max-width:100%}img[data-bookdock-missing]{min-width:2em;min-height:2em;outline:1px dashed currentColor}`
}

export function applyEpubBackgroundContrast(document: Document, enabled: boolean): void {
  let style = document.head.querySelector<HTMLStyleElement>(`#${contrastStyleId}`)
  if (!style) {
    style = document.createElement('style')
    style.id = contrastStyleId
    document.head.append(style)
  }
  style.textContent = enabled ? 'body,body :is(p,span,li,div,section,article,aside,h1,h2,h3,h4,h5,h6,a,td,th,dt,dd,blockquote){color:#fff!important;text-shadow:0 1px 2px #000,0 0 5px #000!important}' : ''
}

export function applyEpubEditorTheme(document: Document, dark: boolean): void {
  const head = document.head
  if (!head) return
  let style = head.querySelector<HTMLStyleElement>(`#${themeStyleId}`)
  if (!style) {
    style = document.createElement('style')
    style.id = themeStyleId
    head.append(style)
  }
  style.textContent = epubThemeCss(dark, document)
}

export function epubEditorFrame(markup: string, dark = false): string {
  const body = markup.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? ''
  const themeDocument = new DOMParser().parseFromString(`<!doctype html><html><body>${body}</body></html>`, 'text/html')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' blob:; font-src blob:; base-uri 'none'; form-action 'none'"><style id="${themeStyleId}">${epubThemeCss(dark, themeDocument)}</style></head><body>${body}</body></html>`
}

type CanonicalNode = ['text', string] | ['element', string | null, string, [string, string, string][], CanonicalNode[]] | ['comment', string] | ['other', number, string]

function canonicalChildren(parent: ParentNode): CanonicalNode[] {
  const result: CanonicalNode[] = []
  for (const node of Array.from(parent.childNodes)) {
    let canonical: CanonicalNode
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? ''
      if (!value) continue
      const previous = result.at(-1)
      if (previous?.[0] === 'text') {
        previous[1] += value
        continue
      }
      canonical = ['text', value]
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element
      const isHtmlElement = element.namespaceURI === 'http://www.w3.org/1999/xhtml'
      const attributes = Array.from(element.attributes)
        .map((attribute) => [attribute.namespaceURI ?? '', isHtmlElement ? attribute.localName.toLowerCase() : attribute.localName, attribute.value] as [string, string, string])
        .sort(([namespaceA, nameA, valueA], [namespaceB, nameB, valueB]) => namespaceA.localeCompare(namespaceB) || nameA.localeCompare(nameB) || valueA.localeCompare(valueB))
      canonical = ['element', element.namespaceURI, isHtmlElement ? element.localName.toLowerCase() : element.localName, attributes, canonicalChildren(element)]
    } else if (node.nodeType === Node.COMMENT_NODE) {
      canonical = ['comment', node.nodeValue ?? '']
    } else {
      canonical = ['other', node.nodeType, node.nodeValue ?? '']
    }
    result.push(canonical)
  }
  return result
}

function canonicalBodyContent(content: string): string {
  const parsed = new DOMParser().parseFromString(`<html><body>${content}</body></html>`, 'text/html')
  return JSON.stringify(canonicalChildren(parsed.body))
}

function preserveUnchangedNodes(markup: string, body: Element): void {
  const parser = new DOMParser()
  const xml = parser.parseFromString(markup, 'application/xhtml+xml')
  const originalBody = xml.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'body')[0]
  if (!originalBody || xml.querySelector('parsererror')) return
  const htmlBody = parser.parseFromString(markup, 'text/html').body
  const preserve = (original: Node, parsed: Node, live: Node) => {
    const originalChildren = Array.from(original.childNodes)
    const parsedChildren = Array.from(parsed.childNodes)
    const liveChildren = Array.from(live.childNodes)
    if (originalChildren.length !== parsedChildren.length || parsedChildren.length !== liveChildren.length) return
    parsedChildren.forEach((parsedChild, index) => {
      const originalChild = originalChildren[index]!
      const liveChild = liveChildren[index]!
      if (originalChild.nodeType !== parsedChild.nodeType || parsedChild.nodeType !== liveChild.nodeType) return
      if (parsedChild.nodeType === Node.ELEMENT_NODE && ((originalChild as Element).localName.toLowerCase() !== (parsedChild as Element).localName.toLowerCase() || (parsedChild as Element).localName !== (liveChild as Element).localName)) return
      if (parsedChild.isEqualNode(liveChild)) live.replaceChild(body.ownerDocument.importNode(originalChild, true), liveChild)
      else if (liveChild.nodeType === Node.ELEMENT_NODE) preserve(originalChild, parsedChild, liveChild)
    })
  }
  preserve(originalBody, htmlBody, body)
}

export function serializeVisibleBody(markup: string, body: Element): string {
  const bodyMatch = markup.match(/<body\b[^>]*>[\s\S]*?<\/body\s*>/i)
  if (!bodyMatch || bodyMatch.index === undefined) throw new Error('EPUB XHTML body is missing')
  const openingTag = bodyMatch[0].match(/^<body\b[^>]*>/i)?.[0]
  const closingTag = bodyMatch[0].match(/<\/body\s*>$/i)?.[0]
  if (!openingTag || !closingTag) throw new Error('EPUB XHTML body is malformed')
  const sourceContent = bodyMatch[0].slice(openingTag.length, bodyMatch[0].length - closingTag.length)
  const cleanBody = originalBody(body)
  if (canonicalBodyContent(sourceContent) === canonicalBodyContent(cleanBody.innerHTML)) return markup
  preserveUnchangedNodes(markup, cleanBody)
  const serializer = new XMLSerializer()
  const serializedBody = serializer.serializeToString(cleanBody)
  const content = serializedBody.replace(/^<body\b[^>]*>/i, '').replace(/<\/body\s*>$/i, '')
  return markup.slice(0, bodyMatch.index) + openingTag + content + closingTag + markup.slice(bodyMatch.index + bodyMatch[0].length)
}

export function locateEpubFragment(document: Document, fragment: string): Element | null {
  let decoded = fragment
  try {
    decoded = decodeURIComponent(fragment)
  } catch {
    decoded = fragment
  }
  return [...document.querySelectorAll('[id]')].find((element) => element.getAttribute('id') === decoded) ?? null
}

export function extractEpubVisibleText(markup: string): string {
  const parsed = new DOMParser().parseFromString(markup, 'application/xhtml+xml')
  const body = parsed.getElementsByTagName('body')[0]
  if (!body || parsed.querySelector('parsererror')) return '无法安全生成可见文字差异。'
  const blocks = new Set(['address', 'article', 'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ol', 'p', 'pre', 'section', 'ul'])
  let result = ''
  const append = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { result += node.nodeValue ?? ''; return }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    const tag = element.localName.toLowerCase()
    if (tag === 'br') { result += '\n'; return }
    const block = blocks.has(tag)
    if (block && result && !result.endsWith('\n')) result += '\n'
    for (const child of Array.from(element.childNodes)) append(child)
    if (block && !result.endsWith('\n')) result += '\n'
  }
  for (const child of Array.from(body.childNodes)) append(child)
  return result.replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function syncEpubHeading(
  document: EpubEditorDocument,
  entry: EpubEditorTocEntry,
  headingIndex: number,
  liveBody: Element,
): EpubEditorDocument {
  const headings = [...liveBody.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  const heading = headings[headingIndex]
  if (!heading) throw new Error('EPUB heading is not available')
  heading.textContent = entry.title
  return { ...document, content: serializeVisibleBody(document.content, liveBody) }
}
