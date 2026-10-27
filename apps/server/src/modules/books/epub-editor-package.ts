import { posix } from 'node:path'

import { DOMParser, Element as XmlElement, XMLSerializer, type Document as XmlDocument } from '@xmldom/xmldom'
import JSZip from 'jszip'

import { resolveEpubResourcePath, loadEpubSpineMarkup } from '../../formats/epub'
import { CONTENT_EDITOR_MAX_TEXT_CHARS, type EditorEpubLoadRes, type EditorEpubSaveReq } from '@bookdock/shared'

const EPUB_NS = 'http://www.idpf.org/2007/ops'
const XHTML_NS = 'http://www.w3.org/1999/xhtml'
const NCX_NS = 'http://www.daisy.org/z3986/2005/ncx/'

function archivePath(baseHref: string, resourceHref: string | null): string {
  const path = resourceHref ? resolveEpubResourcePath(baseHref, resourceHref) : null
  if (!path) throw new Error('EPUB resource path is invalid')
  return path
}

function parseXml(source: string): XmlDocument {
  let parseError: string | null = null
  const document = new DOMParser({ onError: (_level, message) => { parseError ??= message } }).parseFromString(source, 'application/xml')
  if (parseError || !document.documentElement) throw new Error(parseError ?? 'Invalid EPUB XML')
  return document
}

function elementChildren(element: XmlElement, name?: string): XmlElement[] {
  const result: XmlElement[] = []
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && (!name || (child as XmlElement).localName === name)) result.push(child as XmlElement)
  }
  return result
}

function appendTocTree(document: XmlDocument, parent: XmlElement, entries: EditorEpubSaveReq['tocEntries']) {
  replaceChildren(parent, [])
  const stack: Array<{ level: number; list: XmlElement }> = [{ level: 0, list: parent }]
  for (const [index, entry] of entries.entries()) {
    const level = Math.max(1, Math.min(entry.level, entries[index - 1]?.level ? entries[index - 1]!.level + 1 : 1, 20))
    while (stack.length > 1 && stack.at(-1)!.level >= level) stack.pop()
    while (stack.at(-1)!.level < level - 1) {
      const lastItem = stack.at(-1)!.list.lastChild as XmlElement | null
      if (!lastItem || lastItem.localName !== 'li') break
      const childList = document.createElementNS(parent.namespaceURI || XHTML_NS, parent.localName ?? 'ol')
      lastItem.appendChild(childList)
      stack.push({ level: stack.at(-1)!.level + 1, list: childList })
    }
    const item = document.createElementNS(parent.namespaceURI || XHTML_NS, 'li')
    const anchor = document.createElementNS(parent.namespaceURI || XHTML_NS, 'a')
    anchor.setAttribute('href', entry.href)
    anchor.appendChild(document.createTextNode(entry.title))
    item.appendChild(anchor)
    stack.at(-1)!.list.appendChild(item)
  }
}

function replaceChildren(parent: XmlElement, children: XmlElement[]) {
  for (let child = parent.firstChild; child;) {
    const next = child.nextSibling
    parent.removeChild(child)
    child = next
  }
  for (const child of children) parent.appendChild(child)
}

export async function readEpubEditorPackage(source: Buffer): Promise<Omit<EditorEpubLoadRes, 'revisionId'>> {
  const zip = await JSZip.loadAsync(source)
  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('EPUB container document is missing')
  const container = parseXml(await containerFile.async('string'))
  const packagePath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  const packageFile = packagePath ? zip.file(packagePath) : null
  if (!packagePath || !packageFile) throw new Error('EPUB package document is missing')
  const packageDocument = parseXml(await packageFile.async('string'))
  const manifestItems = elementChildren(packageDocument.getElementsByTagName('manifest')[0]!, 'item')
  const spine = packageDocument.getElementsByTagName('spine')[0]
  if (!spine) throw new Error('EPUB spine is missing')
  const itemsById = new Map(manifestItems.map((item) => [item.getAttribute('id'), item]))
  const spineOrder = elementChildren(spine, 'itemref').map((ref) => {
    const item = itemsById.get(ref.getAttribute('idref'))
    if (!item) throw new Error('EPUB spine references a missing manifest item')
    return archivePath(packagePath, item.getAttribute('href'))
  })
  const documents = await loadEpubSpineMarkup(source)
  const navItem = manifestItems.find((item) => (item.getAttribute('properties') ?? '').split(/\s+/).includes('nav'))
  const ncxItem = itemsById.get(spine.getAttribute('toc'))
  const navigationPath = navItem
    ? archivePath(packagePath, navItem.getAttribute('href'))
    : ncxItem ? archivePath(packagePath, ncxItem.getAttribute('href')) : null
  if (!navigationPath) throw new Error('EPUB navigation document is missing')
  const navigationFile = zip.file(navigationPath)
  if (!navigationFile) throw new Error('EPUB navigation document is missing')
  const navigation = parseXml(await navigationFile.async('string'))
  const tocEntries: EditorEpubLoadRes['tocEntries'] = []
  if (navItem) {
    const tocNav = Array.from(navigation.getElementsByTagName('nav')).find((item) =>
      item.getAttributeNS(EPUB_NS, 'type') === 'toc' || item.getAttribute('epub:type') === 'toc')
    const rootList = tocNav?.getElementsByTagName('ol')[0]
    if (rootList) {
      const visitList = (list: XmlElement, level: number) => {
        for (const li of elementChildren(list, 'li')) {
          const anchor = elementChildren(li, 'a')[0]
          if (anchor) {
            const rawHref = anchor.getAttribute('href')
            if (rawHref) {
              const [resourceHref, fragment] = rawHref.split('#', 2)
              const href = archivePath(navigationPath, resourceHref!)
              tocEntries.push({ href: href + (fragment === undefined ? '' : `#${fragment}`), title: anchor.textContent ?? '', level })
            }
          }
          const nestedList = elementChildren(li).find((child) => child.localName === 'ol')
          if (nestedList) visitList(nestedList, Math.min(level + 1, 20))
        }
      }
      visitList(rootList, 1)
    }
  } else {
    const navMap = navigation.getElementsByTagName('navMap')[0]
    const visitPoints = (parent: XmlElement, level: number) => {
      for (const point of elementChildren(parent, 'navPoint')) {
        const label = point.getElementsByTagName('navLabel')[0]?.getElementsByTagName('text')[0]?.textContent ?? ''
        const rawHref = point.getElementsByTagName('content')[0]?.getAttribute('src')
        if (rawHref) {
          const [resourceHref, fragment] = rawHref.split('#', 2)
          const href = archivePath(navigationPath, resourceHref!)
          tocEntries.push({ href: href + (fragment === undefined ? '' : `#${fragment}`), title: label, level })
        }
        visitPoints(point, Math.min(level + 1, 20))
      }
    }
    if (navMap) visitPoints(navMap, 1)
  }
  return { documents: documents.map(({ href, markup }) => ({ href, content: markup })), tocEntries, spineOrder }
}

export async function patchEpubPackage(source: Buffer, request: EditorEpubSaveReq): Promise<Buffer> {
  const zip = await JSZip.loadAsync(source)
  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('EPUB container document is missing')
  const container = parseXml(await containerFile.async('string'))
  const rootfile = container.getElementsByTagName('rootfile')[0]
  const packagePath = rootfile?.getAttribute('full-path')
  if (!packagePath) throw new Error('EPUB package document is missing')
  const packageFile = zip.file(packagePath)
  if (!packageFile) throw new Error('EPUB package document is missing')
  const packageDocument = parseXml(await packageFile.async('string'))
  const manifest = packageDocument.getElementsByTagName('manifest')[0]
  const spine = packageDocument.getElementsByTagName('spine')[0]
  if (!manifest || !spine) throw new Error('EPUB package structure is incomplete')
  const manifestItems = elementChildren(manifest, 'item')
  const manifestById = new Map(manifestItems.map((item) => [item.getAttribute('id'), item]))
  const itemByHref = new Map(manifestItems.map((item) => [archivePath(packagePath, item.getAttribute('href')), item]))
  const spineRefs = elementChildren(spine, 'itemref')
  const spineItems = spineRefs.map((ref) => {
    const item = manifestById.get(ref.getAttribute('idref'))
    if (!item) throw new Error('EPUB spine references a missing manifest item')
    return { ref, href: archivePath(packagePath, item.getAttribute('href')) }
  })
  const currentOrder = spineItems.map((item) => item.href)
  if (request.spineOrder.length !== currentOrder.length || new Set(request.spineOrder).size !== currentOrder.length
    || request.spineOrder.some((href) => !currentOrder.includes(href))) throw new Error('Invalid EPUB spine order')

  const navItem = manifestItems.find((item) => (item.getAttribute('properties') ?? '').split(/\s+/).includes('nav'))
  const ncxId = spine.getAttribute('toc')
  const ncxItem = ncxId ? manifestById.get(ncxId) : undefined
  const navPath = navItem ? archivePath(packagePath, navItem.getAttribute('href')) : null
  const ncxPath = ncxItem ? archivePath(packagePath, ncxItem.getAttribute('href')) : null
  const navigationBase = navPath ?? ncxPath
  if (!navigationBase) throw new Error('EPUB navigation path is invalid')
  const originalEditor = await readEpubEditorPackage(source)
  const allowedDocuments = new Set(originalEditor.documents.map((item) => item.href))
  const tocChanged = originalEditor.tocEntries.length !== request.tocEntries.length
    || originalEditor.tocEntries.some((entry, index) => {
      const updated = request.tocEntries[index]
      return !updated || entry.href !== updated.href || entry.title !== updated.title || entry.level !== updated.level
    })
  const spineChanged = currentOrder.some((href, index) => href !== request.spineOrder[index])
  const allowedTocDocuments = new Set(manifestItems
    .filter((item) => /^(application\/(xhtml\+xml|xml)|text\/html|image\/(png|jpeg|gif|webp|avif|svg\+xml))$/i.test(item.getAttribute('media-type') ?? ''))
    .map((item) => archivePath(packagePath, item.getAttribute('href'))))
  const tocTargets = request.tocEntries.map((entry) => {
    const [entryPath, fragment] = entry.href.split('#', 2)
    const targetHref = allowedTocDocuments.has(entryPath!) ? entryPath! : archivePath(navigationBase, entryPath!)
    if (!allowedTocDocuments.has(targetHref)) throw new Error('EPUB TOC item references an unsupported or missing document')
    return { ...entry, targetHref, fragment }
  })
  const tocEntriesFor = (documentPath: string) => tocTargets.map(({ targetHref, fragment, ...entry }) => ({
    ...entry,
    href: `${posix.relative(posix.dirname(documentPath), targetHref)}${fragment === undefined ? '' : `#${fragment}`}`,
  }))
  const navTocEntries = tocEntriesFor(navPath ?? navigationBase)
  const ncxTocEntries = tocEntriesFor(ncxPath ?? navigationBase)
  const mimetypeFile = zip.file('mimetype')
  if (!mimetypeFile) throw new Error('EPUB mimetype entry is missing')
  zip.file('mimetype', await mimetypeFile.async('nodebuffer'), { compression: 'STORE' })

  for (const patch of request.documents) {
    if (!allowedDocuments.has(patch.href) || patch.content.length > CONTENT_EDITOR_MAX_TEXT_CHARS) throw new Error('Invalid EPUB document update')
    const parsed = parseXml(patch.content)
    if (!parsed.getElementsByTagName('body')[0]) throw new Error('EPUB XHTML document is missing its body')
    zip.file(patch.href, patch.content)
  }

  if (tocChanged && navPath) {
    const navFile = zip.file(navPath)
    if (!navFile) throw new Error('EPUB navigation document is missing')
    const navDocument = parseXml(await navFile.async('string'))
    const tocNav = Array.from(navDocument.getElementsByTagName('nav')).find((item) =>
      item.getAttributeNS(EPUB_NS, 'type') === 'toc' || item.getAttribute('epub:type') === 'toc')
    const tocList = tocNav?.getElementsByTagName('ol')[0]
    if (!tocNav || !tocList) throw new Error('EPUB navigation table of contents is missing')
    appendTocTree(navDocument, tocList, navTocEntries)
    zip.file(navPath, new XMLSerializer().serializeToString(navDocument))
  }
  if (tocChanged && ncxItem) {
    const ncxFile = zip.file(ncxPath!)
    if (!ncxFile) throw new Error('EPUB NCX document is missing')
    const ncxDocument = parseXml(await ncxFile.async('string'))
    const navMap = ncxDocument.getElementsByTagName('navMap')[0]
    if (!navMap) throw new Error('EPUB NCX navigation map is missing')
    const points: XmlElement[] = []
    const stack: Array<{ level: number; point: XmlElement }> = []
    let playOrder = 1
    for (const entry of ncxTocEntries) {
      const point = ncxDocument.createElementNS(NCX_NS, 'navPoint')
      point.setAttribute('id', `editor-nav-${playOrder}`)
      point.setAttribute('playOrder', String(playOrder++))
      const label = ncxDocument.createElementNS(NCX_NS, 'navLabel')
      const title = ncxDocument.createElementNS(NCX_NS, 'text')
      title.appendChild(ncxDocument.createTextNode(entry.title))
      label.appendChild(title)
      point.appendChild(label)
      const content = ncxDocument.createElementNS(NCX_NS, 'content')
      content.setAttribute('src', entry.href)
      point.appendChild(content)
      const level = Math.max(0, Math.min(entry.level, 20))
      while (stack.length > 0 && stack.at(-1)!.level >= level) stack.pop()
      if (stack.length) stack.at(-1)!.point.appendChild(point)
      else points.push(point)
      stack.push({ level, point })
    }
    replaceChildren(navMap, points)
    zip.file(ncxPath!, new XMLSerializer().serializeToString(ncxDocument))
  }
  if (!navPath && !ncxItem) {
    throw new Error('EPUB table of contents cannot be updated')
  }

  const orderedRefs = request.spineOrder.map((href) => {
    const item = itemByHref.get(href)
    if (!item) throw new Error('EPUB spine href is missing from the manifest')
    const id = item.getAttribute('id')
    const ref = spineItems.find((entry) => entry.href === href)?.ref
    if (!id || !ref) throw new Error('EPUB spine item is invalid')
    return ref
  })
  if (spineChanged) {
    for (const ref of orderedRefs) spine.appendChild(ref)
    zip.file(packagePath, new XMLSerializer().serializeToString(packageDocument))
  }
  const output = Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
  if (output.length < 10 || output.readUInt32LE(0) !== 0x04034b50 || output.readUInt16LE(8) !== 0) {
    throw new Error('EPUB mimetype must be the first uncompressed ZIP entry')
  }
  return output
}
