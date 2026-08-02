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
}

interface EpubChapter {
  title: string
  href: string
}

function joinPath(base: string, href: string): string {
  if (!base) return href
  if (base.endsWith('/')) return `${base}${href}`
  const parts = base.split('/')
  parts.pop()
  const baseParts = parts.join('/')
  if (!baseParts) return href
  return `${baseParts}/${href}`
}

function getAttribute(elem: XmlElement, name: string): string | null {
  return elem.getAttribute(name)
}

function getTextContent(elem: XmlElement | null): string {
  return elem?.textContent?.trim() ?? ''
}

function nodeListToArray(list: ArrayLike<XmlElement>): XmlElement[] {
  return Array.from(list)
}

function firstElement(list: ArrayLike<XmlElement>): XmlElement | null {
  return list.length > 0 ? list[0] : null
}

const DESCRIPTION_BLOCK_TAGS = new Set(['p', 'div', 'li', 'tr', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

// Descriptions arrive either as escaped HTML text (Calibre) or as nested XHTML
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
  const zip = await JSZip.loadAsync(buffer)

  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) {
    throw new Error('Invalid EPUB: META-INF/container.xml not found')
  }

  const containerXml = await containerFile.async('text')
  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml')
  const rootfiles = containerDoc.getElementsByTagName('rootfile')
  if (rootfiles.length === 0) {
    throw new Error('Invalid EPUB: rootfile not found in container.xml')
  }
  const opfPath = getAttribute(rootfiles[0], 'full-path')
  if (!opfPath) {
    throw new Error('Invalid EPUB: rootfile missing full-path')
  }

  const opfFile = zip.file(opfPath)
  if (!opfFile) {
    throw new Error(`Invalid EPUB: OPF file ${opfPath} not found`)
  }

  const opfXml = await opfFile.async('text')
  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml')
  const opfDir = opfPath.includes('/') ? `${opfPath.slice(0, opfPath.lastIndexOf('/'))}/` : ''

  const title = getTextContent(firstElement(opfDoc.getElementsByTagName('dc:title')))
  const author = getTextContent(firstElement(opfDoc.getElementsByTagName('dc:creator'))) || undefined

  const bookmeta: BookMetadata = {}
  const publisher = getTextContent(firstElement(opfDoc.getElementsByTagName('dc:publisher')))
  if (publisher) bookmeta.publisher = publisher
  const published = getTextContent(firstElement(opfDoc.getElementsByTagName('dc:date')))
  if (published) bookmeta.published = published
  const language = getTextContent(firstElement(opfDoc.getElementsByTagName('dc:language')))
  if (language) bookmeta.language = language
  const descEl = firstElement(opfDoc.getElementsByTagName('dc:description'))
  if (descEl) {
    const description = normalizeDescription(collectDescriptionText(descEl))
    if (description) bookmeta.description = description
  }
  const subjects = nodeListToArray(opfDoc.getElementsByTagName('dc:subject'))
    .map((el) => getTextContent(el))
    .filter(Boolean)
  if (subjects.length > 0) bookmeta.subjects = subjects
  for (const idEl of nodeListToArray(opfDoc.getElementsByTagName('dc:identifier'))) {
    const value = getTextContent(idEl)
    if (!value) continue
    const scheme = getAttribute(idEl, 'opf:scheme')?.toUpperCase()
    const digits = value.replace(/[- ]/g, '')
    const looksIsbn = /^97[89]\d{10}$/.test(digits) || /^\d{9}[\dXx]$/.test(digits)
    if (scheme === 'ISBN' || looksIsbn) {
      if (!bookmeta.isbn) bookmeta.isbn = value
    } else if (!bookmeta.identifier) {
      bookmeta.identifier = value
    }
  }
  for (const meta of nodeListToArray(opfDoc.getElementsByTagName('meta'))) {
    const name = getAttribute(meta, 'name')
    if (name === 'calibre:series') {
      const series = getAttribute(meta, 'content')
      if (series) bookmeta.series = series
    } else if (name === 'calibre:series_index') {
      const index = parseFloat(getAttribute(meta, 'content') ?? '')
      if (!Number.isNaN(index)) bookmeta.seriesIndex = index
    }
  }

  const manifest: Record<string, ManifestItem> = {}
  const manifestRoot = firstElement(opfDoc.getElementsByTagName('manifest'))
  if (manifestRoot) {
    for (const item of nodeListToArray(manifestRoot.getElementsByTagName('item'))) {
      const id = getAttribute(item, 'id')
      const href = getAttribute(item, 'href')
      const mediaType = getAttribute(item, 'media-type')
      if (id && href && mediaType) {
        manifest[id] = {
          id,
          href: joinPath(opfDir, href),
          mediaType,
          properties: getAttribute(item, 'properties') ?? undefined,
        }
      }
    }
  }

  let cover: Buffer | undefined
  // EPUB 2: <meta name="cover" content="cover-id"/>
  for (const meta of nodeListToArray(opfDoc.getElementsByTagName('meta'))) {
    if (getAttribute(meta, 'name') === 'cover') {
      const coverId = getAttribute(meta, 'content')
      if (coverId && manifest[coverId]) {
        const coverFile = zip.file(manifest[coverId].href)
        if (coverFile) {
          cover = Buffer.from(await coverFile.async('arraybuffer'))
        }
      }
      break
    }
  }

  // EPUB 3: <item properties="cover-image"/>
  if (!cover) {
    const coverItem = Object.values(manifest).find(
      (item) => item.properties?.includes('cover-image'),
    )
    if (coverItem) {
      const coverFile = zip.file(coverItem.href)
      if (coverFile) {
        cover = Buffer.from(await coverFile.async('arraybuffer'))
      }
    }
  }

  // Fallback: first image in manifest
  if (!cover) {
    const imageItem = Object.values(manifest).find(
      (item) => item.mediaType.startsWith('image/'),
    )
    if (imageItem) {
      const coverFile = zip.file(imageItem.href)
      if (coverFile) {
        cover = Buffer.from(await coverFile.async('arraybuffer'))
      }
    }
  }

  const spine: string[] = []
  const spineRoot = firstElement(opfDoc.getElementsByTagName('spine'))
  if (spineRoot) {
    for (const itemref of nodeListToArray(spineRoot.getElementsByTagName('itemref'))) {
      const idref = getAttribute(itemref, 'idref')
      if (idref) spine.push(idref)
    }
  }

  const chapters: EpubChapter[] = []
  const ncxItem = Object.values(manifest).find((item) => item.mediaType === 'application/x-dtbncx+xml')
  if (ncxItem) {
    const ncxFile = zip.file(ncxItem.href)
    if (ncxFile) {
      const ncxXml = await ncxFile.async('text')
      const ncxDoc = new DOMParser().parseFromString(ncxXml, 'application/xml')
      for (const navPoint of nodeListToArray(ncxDoc.getElementsByTagName('navPoint'))) {
        const textEl = firstElement(navPoint.getElementsByTagName('text'))
        const contentEl = firstElement(navPoint.getElementsByTagName('content'))
        const label = getTextContent(textEl)
        const src = contentEl ? getAttribute(contentEl, 'src') : null
        if (src) {
          const href = src.split('#')[0]
          chapters.push({ title: label || href, href: joinPath(ncxItem.href, href) })
        }
      }
    }
  } else {
    const navItem = Object.values(manifest).find((item) => item.properties === 'nav')
    if (navItem) {
      const navFile = zip.file(navItem.href)
      if (navFile) {
        const navXml = await navFile.async('text')
        const navDoc = new DOMParser().parseFromString(navXml, 'application/xml')
        for (const link of nodeListToArray(navDoc.getElementsByTagName('a'))) {
          const href = getAttribute(link, 'href')
          if (href) {
            const base = href.split('#')[0]
            chapters.push({ title: getTextContent(link) || base, href: joinPath(navItem.href, base) })
          }
        }
      }
    }
  }

  if (chapters.length === 0) {
    for (const idref of spine) {
      const item = manifest[idref]
      if (item && item.mediaType === 'application/xhtml+xml') {
        chapters.push({ title: item.href, href: item.href })
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
      const file = zip.file(c.href)
      if (file) {
        try {
          const doc = new DOMParser().parseFromString(await file.async('text'), 'application/xml')
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
    chaptersWithCounts.push({ title: c.title, content: c.href, wordCount })
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

export class EpubParser implements FormatParser {
  match(fileName: string, mime: string): boolean {
    return fileName.endsWith('.epub') || mime === 'application/epub+zip'
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
