import type { Readable } from 'node:stream'
import type { FormatParser, ParsedBook } from './registry'

import JSZip from 'jszip'
import { DOMParser, Element as XmlElement } from '@xmldom/xmldom'

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

  return {
    meta: {
      title: title || 'Untitled',
      author,
      cover,
    },
    chapters: chapters.map((c) => ({
      title: c.title,
      content: c.href,
    })),
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
