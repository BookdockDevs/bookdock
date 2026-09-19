import type { Readable } from 'node:stream'
import type { FormatParser, ParsedBook } from './registry'

import type { BookMetadata } from '@bookdock/shared'

import JSZip from 'jszip'
import { DOMParser, Element as XmlElement } from '@xmldom/xmldom'

import { countWords } from '../lib/word-count'

interface ManifestItem {
  id: string
  href: string
  mediaType: string
  properties?: string
  mediaOverlay?: string
}

export interface EpubChapterMedia {
  type: 'audio' | 'video'
  path: string
}

interface EpubChapter {
  title: string
  href: string
  level: number
}

function isMarkupMediaType(mediaType: string): boolean {
  const normalized = mediaType.trim().toLowerCase().split(';', 1)[0]
  return normalized === 'application/xhtml+xml' || normalized === 'text/html'
}

function normalizeArchivePath(value: string): string {
  let path = value.trim().split(/[?#]/, 1)[0] ?? ''
  path = path.replace(/\\/g, '/')
  try {
    path = decodeURIComponent(path)
  } catch {
    // Keep the original path when a malformed percent escape is present.
  }

  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.join('/')
}

function joinPath(base: string, href: string): string {
  const rawHref = href.trim()
  if (rawHref.startsWith('/')) return normalizeArchivePath(rawHref)

  const rawBase = base.trim()
  const baseDir = rawBase.endsWith('/')
    ? rawBase
    : rawBase.includes('/')
      ? rawBase.slice(0, rawBase.lastIndexOf('/') + 1)
      : ''
  return normalizeArchivePath(`${baseDir}${rawHref}`)
}

function isSafeArchivePath(value: string): boolean {
  let path = value.trim().replace(/\\/g, '/')
  try {
    path = decodeURIComponent(path)
  } catch {
    return false
  }
  return !path.startsWith('/') && !path.split('/').some((part) => part === '..')
}

export function resolveEpubResourcePath(baseHref: string, resourceHref: string): string | null {
  const value = resourceHref.trim()
  if (!value || value.startsWith('#') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return null
  const path = joinPath(baseHref, value)
  return path && isSafeArchivePath(path) ? path : null
}

function createArchiveFileLookup(zip: JSZip): (href: string) => JSZip.JSZipObject | null {
  const exact = new Map<string, JSZip.JSZipObject | null>()
  const insensitive = new Map<string, JSZip.JSZipObject | null>()

  for (const file of Object.values(zip.files)) {
    if (file.dir) continue
    const path = normalizeArchivePath(file.name)
    if (!exact.has(path)) exact.set(path, file)
    else if (exact.get(path) !== file) exact.set(path, null)

    const key = path.toLowerCase()
    if (!insensitive.has(key)) {
      insensitive.set(key, file)
    } else if (insensitive.get(key) !== file) {
      insensitive.set(key, null)
    }
  }

  return (href) => {
    const path = normalizeArchivePath(href)
    return exact.get(path) ?? insensitive.get(path.toLowerCase()) ?? null
  }
}

function hasManifestProperty(item: ManifestItem, property: string): boolean {
  return item.properties?.split(/\s+/).some((value) => value.toLowerCase() === property) ?? false
}

async function readArchiveText(file: JSZip.JSZipObject): Promise<string> {
  const bytes = Buffer.from(await file.async('uint8array'))
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const littleEndian = Buffer.alloc(bytes.length - 2)
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      littleEndian[i - 2] = bytes[i + 1] ?? 0
      littleEndian[i - 1] = bytes[i] ?? 0
    }
    return littleEndian.toString('utf16le')
  }
  return bytes.toString('utf8').replace(/^\uFEFF/, '')
}

function isUsableCoverBuffer(buffer: Buffer, mediaType: string): boolean {
  if (buffer.length === 0) return false

  const normalizedType = mediaType.toLowerCase()
  if (normalizedType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (normalizedType === 'image/jpeg' || normalizedType === 'image/jpg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (normalizedType === 'image/gif') {
    return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a'
  }
  if (normalizedType === 'image/webp') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  if (normalizedType === 'image/svg+xml') {
    const header = buffer.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '')
    return /<svg(?:\s|>)/i.test(header)
  }

  // Keep uncommon image formats available when the package declares them
  // correctly; this check only rejects known formats with invalid signatures.
  return normalizedType.startsWith('image/')
}

function detectImageMediaType(buffer: Buffer): string | null {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  const signature = buffer.subarray(0, 6).toString('ascii')
  if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  const header = buffer.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '')
  if (/<svg(?:\s|>)/i.test(header)) return 'image/svg+xml'
  return null
}

function coverMediaType(buffer: Buffer, declaredType: string): string {
  return detectImageMediaType(buffer) ?? declaredType.toLowerCase().split(';', 1)[0]
}

function getAttribute(elem: XmlElement, name: string): string | null {
  return elem.getAttribute(name)
}

function getNamespacedAttribute(elem: XmlElement, namespace: string, localName: string, legacyName: string): string | null {
  return elem.getAttributeNS?.(namespace, localName) || getAttribute(elem, legacyName) || getAttribute(elem, localName)
}

function getTextContent(elem: XmlElement | null): string {
  return elem?.textContent?.trim() ?? ''
}

function nodeListToArray(list: ArrayLike<XmlElement>): XmlElement[] {
  return Array.from(list)
}

function childElements(root: XmlElement): XmlElement[] {
  return Array.from(root.childNodes).filter((node) => node.nodeType === 1) as XmlElement[]
}

function childElementsByLocalName(root: XmlElement, localName: string): XmlElement[] {
  return childElements(root).filter((element) => {
    const name = element.localName ?? element.tagName.split(':').pop()
    return name?.toLowerCase() === localName.toLowerCase()
  })
}

function collectNcxNavPoints(parent: XmlElement, chapters: EpubChapter[], level: number): void {
  for (const navPoint of childElementsByLocalName(parent, 'navPoint')) {
    const textEl = firstElement(elementsByLocalName(navPoint, 'text'))
    const contentEl = firstElement(elementsByLocalName(navPoint, 'content'))
    const label = getTextContent(textEl)
    const src = contentEl ? getAttribute(contentEl, 'src') : null
    if (src) {
      const href = src.split('#')[0]
      if (href) chapters.push({ title: label || href, href, level })
    }
    collectNcxNavPoints(navPoint, chapters, level + 1)
  }
}

function collectEpub3NavList(list: XmlElement, chapters: EpubChapter[], level: number): void {
  for (const item of childElementsByLocalName(list, 'li')) {
    const link = firstElement(childElementsByLocalName(item, 'a'))
    const href = link ? getAttribute(link, 'href') : null
    if (href) {
      const base = href.split('#')[0]
      if (base) chapters.push({ title: getTextContent(link) || base, href: base, level })
    }
    for (const nestedList of childElementsByLocalName(item, 'ol')) {
      collectEpub3NavList(nestedList, chapters, level + 1)
    }
  }
}

function elementsByLocalName(root: { getElementsByTagName: (name: string) => ArrayLike<XmlElement> }, localName: string): XmlElement[] {
  return nodeListToArray(root.getElementsByTagName('*')).filter((element) => {
    const name = element.localName ?? element.tagName.split(':').pop()
    return name?.toLowerCase() === localName.toLowerCase()
  })
}

function firstElement(list: ArrayLike<XmlElement>): XmlElement | null {
  return list.length > 0 ? list[0] : null
}

function metadataValue(elem: XmlElement): string {
  return getAttribute(elem, 'content') || getTextContent(elem)
}

const DESCRIPTION_BLOCK_TAGS = new Set(['p', 'div', 'li', 'tr', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

// Descriptions arrive either as escaped HTML text or as nested XHTML
// elements; both must keep paragraph breaks instead of flattening into one line.
function collectDescriptionText(el: XmlElement): string {
  let out = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? ''
    } else if (node.nodeType === 1) {
      const child = node as XmlElement
      const tag = child.tagName.toLowerCase()
      if (tag === 'br') {
        out += '\n'
      } else {
        out += collectDescriptionText(child)
        if (DESCRIPTION_BLOCK_TAGS.has(tag)) out += '\n\n'
      }
    }
  }
  return out
}

function normalizeDescription(raw: string): string {
  return raw
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|blockquote|h[1-6])\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function parseEpubBuffer(buffer: Buffer): Promise<ParsedBook> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch (error) {
    throw new Error('Invalid EPUB: corrupt ZIP archive', { cause: error })
  }
  const findArchiveFile = createArchiveFileLookup(zip)

  const containerFile = findArchiveFile('META-INF/container.xml')
  if (!containerFile) {
    throw new Error('Invalid EPUB: META-INF/container.xml not found')
  }

  const containerXml = await readArchiveText(containerFile)
  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml')
  const rootfiles = elementsByLocalName(containerDoc, 'rootfile')
  if (rootfiles.length === 0) {
    throw new Error('Invalid EPUB: rootfile not found in container.xml')
  }
  const rootfile = rootfiles.find((file) => getAttribute(file, 'media-type')?.trim().toLowerCase().split(';', 1)[0] === 'application/oebps-package+xml')
    ?? rootfiles[0]
  const opfPathValue = getAttribute(rootfile, 'full-path')
  const opfPath = opfPathValue ? normalizeArchivePath(opfPathValue) : ''
  if (!opfPath) {
    throw new Error('Invalid EPUB: rootfile missing full-path')
  }

  const opfFile = findArchiveFile(opfPath)
  if (!opfFile) {
    throw new Error(`Invalid EPUB: OPF file ${opfPath} not found`)
  }

  const opfXml = await readArchiveText(opfFile)
  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml')
  const opfDir = opfPath.includes('/') ? `${opfPath.slice(0, opfPath.lastIndexOf('/'))}/` : ''

  const metadataMetas = elementsByLocalName(opfDoc, 'meta')
  const refinedMetas = new Map<string, XmlElement[]>()
  for (const meta of metadataMetas) {
    const refines = getAttribute(meta, 'refines')
    if (!refines?.startsWith('#')) continue
    const list = refinedMetas.get(refines.slice(1)) ?? []
    list.push(meta)
    refinedMetas.set(refines.slice(1), list)
  }
  const refinedValues = (elem: XmlElement, property: string) => {
    const id = getAttribute(elem, 'id')
    if (!id) return []
    return (refinedMetas.get(id) ?? [])
      .filter((meta) => {
        const value = getAttribute(meta, 'property')?.toLowerCase() ?? ''
        return value === property || value.endsWith(`:${property}`)
      })
      .map(metadataValue)
      .filter(Boolean)
  }
  const titleElements = elementsByLocalName(opfDoc, 'title')
  const mainTitle = titleElements.find((elem) => refinedValues(elem, 'title-type').some((value) => value.toLowerCase() === 'main'))
    ?? firstElement(titleElements)
  const title = getTextContent(mainTitle)
  const subtitle = titleElements.find((elem) => refinedValues(elem, 'title-type').some((value) => value.toLowerCase() === 'subtitle'))
  const titleSortAs = mainTitle
    ? getNamespacedAttribute(mainTitle, 'http://www.idpf.org/2007/opf', 'file-as', 'opf:file-as') ?? undefined
    : undefined
  const creatorElements = elementsByLocalName(opfDoc, 'creator')
  const contributorElements = elementsByLocalName(opfDoc, 'contributor')
  const getRole = (elem: XmlElement): string | undefined => {
    const directRole = getNamespacedAttribute(elem, 'http://www.idpf.org/2007/opf', 'role', 'opf:role')
    return directRole || refinedValues(elem, 'role')[0] || undefined
  }
  const roleCreator = creatorElements.find((elem) => {
    const directRole = getRole(elem)?.toLowerCase()
    return directRole === 'aut' || directRole === 'author' || refinedValues(elem, 'role').some((value) => /^(aut|author)$/i.test(value))
  })
  const author = getTextContent(roleCreator ?? firstElement(creatorElements)) || undefined
  const authorSortAs = roleCreator
    ? getNamespacedAttribute(roleCreator, 'http://www.idpf.org/2007/opf', 'file-as', 'opf:file-as') ?? undefined
    : undefined

  const bookmeta: BookMetadata = {}
  const publisher = getTextContent(firstElement(elementsByLocalName(opfDoc, 'publisher')))
  if (publisher) bookmeta.publisher = publisher
  const published = getTextContent(firstElement(elementsByLocalName(opfDoc, 'date')))
  if (published) bookmeta.published = published
  const languageElements = elementsByLocalName(opfDoc, 'language')
  const languages = languageElements.map(getTextContent).filter(Boolean)
  const language = languages[0]
  if (language) bookmeta.language = language
  if (languages.length > 1) bookmeta.languages = [...new Set(languages)]
  if (subtitle) bookmeta.subtitle = getTextContent(subtitle)
  if (titleSortAs) bookmeta.sortAs = titleSortAs
  if (authorSortAs) bookmeta.authorSortAs = authorSortAs
  const modified = metadataMetas.find((meta) => {
    const property = getAttribute(meta, 'property')?.toLowerCase() ?? ''
    return property === 'dcterms:modified' || property.endsWith(':modified')
  })
  if (modified) bookmeta.modified = metadataValue(modified) || undefined
  const rights = getTextContent(firstElement(elementsByLocalName(opfDoc, 'rights')))
  if (rights) bookmeta.rights = rights
  const source = getTextContent(firstElement(elementsByLocalName(opfDoc, 'source')))
  if (source) bookmeta.source = source
  const descEl = firstElement(elementsByLocalName(opfDoc, 'description'))
  if (descEl) {
    const description = normalizeDescription(collectDescriptionText(descEl))
    if (description) bookmeta.description = description
  }
  const subjectElements = elementsByLocalName(opfDoc, 'subject')
  const subjectDetails = subjectElements
    .map((el) => ({
      name: getTextContent(el),
      term: getNamespacedAttribute(el, 'http://www.idpf.org/2007/opf', 'term', 'opf:term') ?? undefined,
      authority: getNamespacedAttribute(el, 'http://www.idpf.org/2007/opf', 'authority', 'opf:authority') ?? undefined,
    }))
    .filter((subject) => subject.name)
  const subjects = subjectDetails.map((subject) => subject.name)
  if (subjects.length > 0) bookmeta.subjects = subjects
  if (subjectDetails.length > 0) bookmeta.subjectDetails = subjectDetails
  const contributors = [...creatorElements, ...contributorElements]
    .map((elem) => ({
      name: getTextContent(elem),
      role: getRole(elem),
      sortAs: getNamespacedAttribute(elem, 'http://www.idpf.org/2007/opf', 'file-as', 'opf:file-as') ?? undefined,
    }))
    .filter((contributor) => contributor.name)
  const hasStructuredContributors = contributors.length > 0 && (
    contributorElements.length > 0
    || contributors.length > 1
    || contributors.some((contributor) => contributor.role || contributor.sortAs)
  )
  if (hasStructuredContributors) bookmeta.contributors = contributors
  for (const meta of metadataMetas) {
    const property = getAttribute(meta, 'property')?.toLowerCase() ?? ''
    if (property !== 'belongs-to-collection' && !property.endsWith(':belongs-to-collection')) continue
    const value = metadataValue(meta)
    if (!value) continue
    const id = getAttribute(meta, 'id')
    const collectionType = id
      ? refinedMetas.get(id)?.find((item) => {
        const property = getAttribute(item, 'property')?.toLowerCase() ?? ''
        return property === 'collection-type' || property.endsWith(':collection-type')
      })
      : undefined
    if (collectionType && metadataValue(collectionType).toLowerCase() !== 'series') continue
    bookmeta.series = value
    const position = id
      ? refinedMetas.get(id)?.find((item) => {
        const property = getAttribute(item, 'property')?.toLowerCase() ?? ''
        return property === 'group-position' || property.endsWith(':group-position')
      })
      : undefined
    const index = Number.parseFloat(position ? metadataValue(position) : '')
    if (Number.isFinite(index)) bookmeta.seriesIndex = index
    break
  }
  for (const idEl of elementsByLocalName(opfDoc, 'identifier')) {
    const value = getTextContent(idEl)
    if (!value) continue
    const scheme = getNamespacedAttribute(idEl, 'http://www.idpf.org/2007/opf', 'scheme', 'opf:scheme')?.toUpperCase()
    const digits = value.replace(/[- ]/g, '')
    const looksIsbn = /^97[89]\d{10}$/.test(digits) || /^\d{9}[\dXx]$/.test(digits)
    if (scheme === 'ISBN' || looksIsbn) {
      if (!bookmeta.isbn) bookmeta.isbn = value
    } else if (!bookmeta.identifier) {
      bookmeta.identifier = value
    }
  }
  for (const meta of metadataMetas) {
    const name = getAttribute(meta, 'name')?.toLowerCase()
    if (name === 'calibre:series' && !bookmeta.series) {
      const series = getAttribute(meta, 'content')
      if (series) bookmeta.series = series
    } else if (name === 'calibre:series_index' && bookmeta.seriesIndex === undefined) {
      const index = parseFloat(getAttribute(meta, 'content') ?? '')
      if (!Number.isNaN(index)) bookmeta.seriesIndex = index
    }
  }

  const manifest: Record<string, ManifestItem> = {}
  const manifestRoot = firstElement(elementsByLocalName(opfDoc, 'manifest'))
  if (manifestRoot) {
    for (const item of elementsByLocalName(manifestRoot, 'item')) {
      const id = getAttribute(item, 'id')
      const href = getAttribute(item, 'href')
      const mediaType = getAttribute(item, 'media-type')
      if (id && href && mediaType) {
        manifest[id] = {
          id,
          href: joinPath(opfDir, href),
          mediaType: mediaType.trim().toLowerCase().split(';', 1)[0],
          properties: getAttribute(item, 'properties') ?? undefined,
          mediaOverlay: getAttribute(item, 'media-overlay') ?? undefined,
        }
      }
    }
  }

  const manifestItems = Object.values(manifest)
  const imageItems = manifestItems.filter((item) => item.mediaType.toLowerCase().startsWith('image/'))
  const coverCandidates: ManifestItem[] = []
  const addCoverCandidate = (item: ManifestItem | undefined) => {
    if (item && !coverCandidates.includes(item)) coverCandidates.push(item)
  }

  // EPUB 3 is the authoritative declaration when both cover conventions exist.
  addCoverCandidate(manifestItems.find(
    (item) => item.mediaType.toLowerCase().startsWith('image/') && hasManifestProperty(item, 'cover-image'),
  ))

  // EPUB 2: <meta name="cover" content="cover-id"/>. Some books point this
  // at a cover XHTML page, which is not itself a usable cover image.
  const legacyCoverMeta = metadataMetas.find(
    (meta) => getAttribute(meta, 'name')?.toLowerCase() === 'cover',
  )
  const legacyCoverId = legacyCoverMeta ? getAttribute(legacyCoverMeta, 'content') : null
  const legacyCoverItem = legacyCoverId ? manifest[legacyCoverId] : undefined
  if (legacyCoverItem?.mediaType.toLowerCase().startsWith('image/')) addCoverCandidate(legacyCoverItem)

  const heuristicImageItems = imageItems.filter((item) => !hasManifestProperty(item, 'nav'))
  const rasterItems = heuristicImageItems.filter((item) => item.mediaType.toLowerCase() !== 'image/svg+xml')
  const svgItems = heuristicImageItems.filter((item) => item.mediaType.toLowerCase() === 'image/svg+xml')
  const isCoverNamed = (item: ManifestItem) => {
    const name = `${item.id}/${item.href}`.toLowerCase()
    return name.includes('cover')
  }

  // Cover resolution heuristic: look for named raster covers first, then any
  // raster image, and only use SVG when the package has no raster alternative.
  for (const item of rasterItems.filter(isCoverNamed)) addCoverCandidate(item)
  for (const item of rasterItems) addCoverCandidate(item)
  for (const item of svgItems.filter(isCoverNamed)) addCoverCandidate(item)
  for (const item of svgItems) addCoverCandidate(item)

  let cover: Buffer | undefined
  for (const candidate of coverCandidates) {
    const coverFile = findArchiveFile(candidate.href)
    if (!coverFile) continue
    const candidateBuffer = Buffer.from(await coverFile.async('arraybuffer'))
    if (!isUsableCoverBuffer(candidateBuffer, coverMediaType(candidateBuffer, candidate.mediaType))) continue
    cover = candidateBuffer
    break
  }

  const spine: string[] = []
  const spineRoot = firstElement(elementsByLocalName(opfDoc, 'spine'))
  const spineTocId = spineRoot ? getAttribute(spineRoot, 'toc') : null
  if (spineRoot) {
    for (const itemref of elementsByLocalName(spineRoot, 'itemref')) {
      const idref = getAttribute(itemref, 'idref')
      if (idref) spine.push(idref)
    }
  }

  if (!cover) {
    const coverPageItems = manifestItems.filter((item) =>
      isMarkupMediaType(item.mediaType) && (isCoverNamed(item) || item === legacyCoverItem || spine.includes(item.id)),
    )
    for (const coverPage of coverPageItems) {
      const coverPageFile = findArchiveFile(coverPage.href)
      if (!coverPageFile) continue
      const coverPageXml = await readArchiveText(coverPageFile)
      const coverPageDoc = new DOMParser().parseFromString(coverPageXml, 'application/xhtml+xml')
      const image = firstElement(elementsByLocalName(coverPageDoc, 'img'))
        ?? firstElement(elementsByLocalName(coverPageDoc, 'image'))
      if (!image) continue
      const imageHref = getAttribute(image, 'src')
        || getAttribute(image, 'href')
        || getAttribute(image, 'xlink:href')
        || image.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href')
      if (!imageHref) continue
      const resolvedImageHref = joinPath(coverPage.href, imageHref)
      const imageItem = manifestItems.find((item) => item.href.toLowerCase() === resolvedImageHref.toLowerCase())
      const mediaType = imageItem?.mediaType.toLowerCase()
        ?? (resolvedImageHref.toLowerCase().endsWith('.png') ? 'image/png'
          : resolvedImageHref.toLowerCase().endsWith('.gif') ? 'image/gif'
            : resolvedImageHref.toLowerCase().endsWith('.webp') ? 'image/webp'
              : resolvedImageHref.toLowerCase().endsWith('.svg') ? 'image/svg+xml'
                : 'image/jpeg')
      const imageFile = findArchiveFile(resolvedImageHref)
      if (!imageFile) continue
      const imageBuffer = Buffer.from(await imageFile.async('arraybuffer'))
      if (!isUsableCoverBuffer(imageBuffer, coverMediaType(imageBuffer, mediaType))) continue
      cover = imageBuffer
      break
    }
  }

  if (!cover) {
    for (const fallbackPath of ['iTunesArtwork', 'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.gif', 'cover.webp', 'cover.svg']) {
      const fallbackFile = findArchiveFile(fallbackPath)
      if (!fallbackFile) continue
      const lowerPath = fallbackPath.toLowerCase()
      const mediaType = lowerPath.endsWith('.png') ? 'image/png'
        : lowerPath.endsWith('.gif') ? 'image/gif'
          : lowerPath.endsWith('.webp') ? 'image/webp'
            : lowerPath.endsWith('.svg') ? 'image/svg+xml'
              : 'image/jpeg'
      const fallbackBuffer = Buffer.from(await fallbackFile.async('arraybuffer'))
      if (!isUsableCoverBuffer(fallbackBuffer, coverMediaType(fallbackBuffer, mediaType))) continue
      cover = fallbackBuffer
      break
    }
  }

  const chapters: EpubChapter[] = []
  const ncxItem = (spineTocId ? manifest[spineTocId] : undefined)
    ?? Object.values(manifest).find((item) => item.mediaType.trim().toLowerCase().split(';', 1)[0] === 'application/x-dtbncx+xml')
  if (ncxItem) {
    const ncxFile = findArchiveFile(ncxItem.href)
    if (ncxFile) {
      const ncxXml = await readArchiveText(ncxFile)
      const ncxDoc = new DOMParser().parseFromString(ncxXml, 'application/xml')
      const navMap = firstElement(elementsByLocalName(ncxDoc, 'navMap'))
      if (navMap) {
        const tocEntries: EpubChapter[] = []
        collectNcxNavPoints(navMap, tocEntries, 1)
        chapters.push(...tocEntries.map((chapter) => ({
          ...chapter,
          href: joinPath(ncxItem.href, chapter.href),
        })))
      }
    }
  }

  // A stale spine toc or a missing NCX must not hide a valid EPUB3 nav.
  // Keep the nav fallback available when the preferred source cannot
  // produce a usable TOC.
  if (chapters.length === 0) {
    const navItem = Object.values(manifest).find(
      (item) => isMarkupMediaType(item.mediaType) && hasManifestProperty(item, 'nav'),
    )
    if (navItem) {
      const navFile = findArchiveFile(navItem.href)
      if (navFile) {
        const navXml = await readArchiveText(navFile)
        const navDoc = new DOMParser().parseFromString(navXml, 'application/xml')
        const navElements = elementsByLocalName(navDoc, 'nav')
        const tocNav = navElements.find((nav) => {
          const type = getAttribute(nav, 'epub:type') ?? getAttribute(nav, 'type') ?? ''
          return type.split(/\s+/).some((value) => value.toLowerCase() === 'toc')
        })
        const tocEntries: EpubChapter[] = []
        const tocList = tocNav ? firstElement(elementsByLocalName(tocNav, 'ol')) : null
        if (tocList) {
          collectEpub3NavList(tocList, tocEntries, 1)
        } else {
          const links = elementsByLocalName(tocNav ?? navDoc, 'a')
          for (const link of nodeListToArray(links)) {
            const href = getAttribute(link, 'href')
            if (href) {
              const base = href.split('#')[0]
              if (base) tocEntries.push({ title: getTextContent(link) || base, href: base, level: 1 })
            }
          }
        }
        chapters.push(...tocEntries.map((chapter) => ({
          ...chapter,
          href: joinPath(navItem.href, chapter.href),
        })))
      }
    }
  }

  if (chapters.length === 0) {
    for (const idref of spine) {
      const item = manifest[idref]
      if (item && isMarkupMediaType(item.mediaType)) {
        chapters.push({ title: item.href, href: item.href, level: 1 })
      }
    }
  }

  const chapterTexts = new Map<string, string>()
  const countedFiles = new Set<string>()
  const chaptersWithCounts: ParsedBook['chapters'] = []
  for (const c of chapters) {
    let text = chapterTexts.get(c.href)
    if (text === undefined) {
      text = ''
      const file = findArchiveFile(c.href)
      if (file) {
        try {
          const doc = new DOMParser().parseFromString(await readArchiveText(file), 'application/xml')
          text = doc.documentElement?.textContent ?? ''
        } catch {
          // An unreadable chapter file counts as 0 words, not a failed upload.
        }
      }
      chapterTexts.set(c.href, text)
    }
    // Several TOC entries can point into one file via fragments; count the
    // file only once so per-chapter counts sum to the true book total.
    const wordCount = countedFiles.has(c.href) ? 0 : countWords(text)
    countedFiles.add(c.href)
    chaptersWithCounts.push({
      title: c.title,
      content: c.href,
      ...(c.level > 1 ? { level: c.level } : {}),
      wordCount,
    })
  }

  return {
    meta: {
      title: title || 'Untitled',
      author,
      cover,
      bookmeta: Object.keys(bookmeta).length > 0 ? bookmeta : undefined,
    },
    chapters: chaptersWithCounts,
  }
}

const READING_BLOCK_TAGS = new Set(['p', 'div', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre'])

function collectReadingText(node: XmlElement): string {
  let text = ''
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      text += child.nodeValue ?? ''
      continue
    }
    if (child.nodeType !== 1) continue
    const element = child as XmlElement
    const tag = element.tagName.toLowerCase()
    if (tag === 'br') {
      text += '\n'
      continue
    }
    text += collectReadingText(element)
    if (READING_BLOCK_TAGS.has(tag)) text += '\n\n'
  }
  return text
}

function normalizeReadingText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function loadEpubChapterMedia(zip: JSZip, chapterHref: string): Promise<EpubChapterMedia[]> {
  const findArchiveFile = createArchiveFileLookup(zip)
  const containerFile = findArchiveFile('META-INF/container.xml')
  if (!containerFile) return []
  const containerDoc = new DOMParser().parseFromString(await readArchiveText(containerFile), 'application/xml')
  const rootfile = elementsByLocalName(containerDoc, 'rootfile')[0]
  const opfPath = rootfile ? normalizeArchivePath(getAttribute(rootfile, 'full-path') ?? '') : ''
  if (!opfPath) return []
  const opfFile = findArchiveFile(opfPath)
  if (!opfFile) return []
  const opfDoc = new DOMParser().parseFromString(await readArchiveText(opfFile), 'application/xml')
  const opfDir = opfPath.includes('/') ? `${opfPath.slice(0, opfPath.lastIndexOf('/'))}/` : ''
  const manifest = new Map<string, ManifestItem>()
  for (const item of elementsByLocalName(opfDoc, 'item')) {
    const id = getAttribute(item, 'id')
    const href = getAttribute(item, 'href')
    const mediaType = getAttribute(item, 'media-type')
    if (!id || !href || !mediaType) continue
    manifest.set(id, {
      id,
      href: joinPath(opfDir, href),
      mediaType: mediaType.trim().toLowerCase().split(';', 1)[0],
      mediaOverlay: getAttribute(item, 'media-overlay') ?? undefined,
    })
  }

  const chapter = [...manifest.values()].find((item) => item.href === normalizeArchivePath(chapterHref))
  const overlay = chapter?.mediaOverlay ? manifest.get(chapter.mediaOverlay) : undefined
  if (!overlay || !overlay.mediaType.includes('smil')) return []
  const smilFile = findArchiveFile(overlay.href)
  if (!smilFile) return []
  const smilDoc = new DOMParser().parseFromString(await readArchiveText(smilFile), 'application/xml')
  const media = new Map<string, EpubChapterMedia>()
  for (const audio of elementsByLocalName(smilDoc, 'audio')) {
    const src = getAttribute(audio, 'src')
    const path = src ? resolveEpubResourcePath(overlay.href, src) : null
    if (path && !media.has(path)) media.set(path, { type: 'audio', path })
  }
  return [...media.values()]
}

/** Extract one chapter in reading order for server-side AI tools. */
export async function loadEpubChapterMarkup(buffer: Buffer, chapterIndex: number): Promise<{ href: string; markup: string; media: EpubChapterMedia[] } | null> {
  const parsed = await parseEpubBuffer(buffer)
  const chapter = parsed.chapters[chapterIndex]
  if (!chapter) return null
  const zip = await JSZip.loadAsync(buffer)
  const file = createArchiveFileLookup(zip)(chapter.content)
  if (!file) return null
  return { href: chapter.content, markup: await readArchiveText(file), media: await loadEpubChapterMedia(zip, chapter.content) }
}

export interface EpubResource {
  data: Buffer
  mediaType: string
}

function epubResourceMediaType(path: string): string | null {
  const extension = path.toLowerCase().split(/[./]/).pop() ?? ''
  return {
    avif: 'image/avif',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    m4a: 'audio/mp4',
    mid: 'audio/midi',
    midi: 'audio/midi',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    png: 'image/png',
    svg: 'image/svg+xml',
    wav: 'audio/wav',
    webm: 'video/webm',
    webp: 'image/webp',
  }[extension] ?? null
}

export function isEpubMediaPath(path: string): boolean {
  return epubResourceMediaType(path) !== null
}

export async function loadEpubResource(buffer: Buffer, resourcePath: string): Promise<EpubResource | null> {
  if (!isSafeArchivePath(resourcePath)) return null
  const mediaType = epubResourceMediaType(resourcePath)
  if (!mediaType) return null
  const zip = await JSZip.loadAsync(buffer)
  const file = createArchiveFileLookup(zip)(resourcePath)
  if (!file) return null
  return {
    data: Buffer.from(await file.async('uint8array')),
    mediaType,
  }
}

export async function extractEpubChapterText(buffer: Buffer, chapterIndex: number): Promise<string> {
  const chapter = await loadEpubChapterMarkup(buffer, chapterIndex)
  if (!chapter) return ''
  const doc = new DOMParser().parseFromString(chapter.markup, 'application/xml')
  const body = firstElement(doc.getElementsByTagName('body')) ?? doc.documentElement
  return body ? normalizeReadingText(collectReadingText(body)) : ''
}

export class EpubParser implements FormatParser {
  match(fileName: string, mime: string): boolean {
    const normalizedMime = mime.trim().toLowerCase().split(';', 1)[0]
    return fileName.toLowerCase().endsWith('.epub') || normalizedMime === 'application/epub+zip'
  }

  async parse(data: Buffer | Readable): Promise<ParsedBook> {
    const buf = Buffer.isBuffer(data) ? data : await bufferFromReadable(data)
    return parseEpubBuffer(buf)
  }
}

async function bufferFromReadable(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
