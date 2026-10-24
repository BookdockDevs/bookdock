import { inflateRawSync } from 'node:zlib'

import { DOMParser, Element as XmlElement } from '@xmldom/xmldom'

import {
  READER_ENTRY_MAX_BYTES,
  READER_STARTUP_MAX_BYTES,
  type ReaderManifestEntry,
  type ReaderManifestFile,
  type ReaderManifestSpineItem,
} from '@bookdock/shared'

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const MAX_TAIL_BYTES = 128 * 1024
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 100_000
const MAX_PATH_LENGTH = 4096
const MAX_STARTUP_FILES = 16

const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0'

const MEDIA_TYPES: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  css: 'text/css',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  m4a: 'audio/mp4',
  mid: 'audio/midi',
  midi: 'audio/midi',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ncx: 'application/x-dtbncx+xml',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opf: 'application/oebps-package+xml',
  opus: 'audio/opus',
  otf: 'font/otf',
  png: 'image/png',
  smil: 'application/smil+xml',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  xhtml: 'application/xhtml+xml',
  xml: 'application/xml',
}

export interface EpubByteSource {
  size: number
  read(start: number, endInclusive: number): Promise<Buffer>
}

export interface EpubIndexEntry {
  path: string
  size: number
  compressedSize: number
  compression: ReaderManifestEntry['compression']
  method: number
  flags: number
  crc32: number
  localHeaderOffset: number
}

export interface EpubArchive {
  source: EpubByteSource
  centralDirectoryOffset: number
  entries: EpubIndexEntry[]
  byPath: Map<string, EpubIndexEntry | null>
  byLowerPath: Map<string, EpubIndexEntry | null>
}

export interface EpubTocItem {
  title: string
  href: string
  level: number
}

export interface EpubManifestItem {
  id: string
  href: string
  mediaType: string
  properties?: string
  mediaOverlay?: string
}

export interface EpubStartup {
  startupFiles: ReaderManifestFile[]
  opfPath: string
  navPath: string | null
  ncxPath: string | null
  spine: ReaderManifestSpineItem[]
  toc: EpubTocItem[]
  manifest: EpubManifestItem[]
}

export class EpubIndexError extends Error {
  constructor(public readonly code: 'CORRUPT' | 'LIMIT' | 'UNSUPPORTED', message: string) {
    super(message)
    this.name = 'EpubIndexError'
  }
}

function decodeZipName(bytes: Buffer, flags: number): string {
  if (flags & 0x800) return bytes.toString('utf8')
  let out = ''
  for (const byte of bytes) {
    out += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80] ?? '\uFFFD'
  }
  return out
}

export function normalizeReaderEntryPath(raw: string): string | null {
  if (!raw || raw.length > MAX_PATH_LENGTH) return null
  let path = raw.replace(/\\/g, '/')
  if (path.startsWith('/')) return null
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') return null
    parts.push(part)
  }
  if (parts.length === 0) return null
  path = parts.join('/')
  return path.length <= MAX_PATH_LENGTH ? path : null
}

function normalizeManifestHref(raw: string): string {
  let path = raw.trim().split(/[?#]/, 1)[0] ?? ''
  path = path.replace(/\\/g, '/')
  try {
    path = decodeURIComponent(path)
  } catch {
    // Keep a malformed escape rather than losing the reference entirely.
  }
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return ''
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return normalizeReaderEntryPath(parts.join('/')) ?? ''
}

function joinManifestPath(base: string, href: string): string {
  const value = href.trim()
  if (value.startsWith('/')) return normalizeManifestHref(value)
  const basePath = base.trim()
  const dir = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/') + 1) : ''
  return normalizeManifestHref(`${dir}${value}`)
}

export function readerMediaTypeForPath(path: string, declared?: string | null): string {
  const normalized = declared?.trim().toLowerCase().split(';', 1)[0]
  if (normalized) return normalized
  const extension = path.toLowerCase().split(/[./]/).pop() ?? ''
  return MEDIA_TYPES[extension] ?? 'application/octet-stream'
}

function readUInt64(buffer: Buffer, offset: number): number {
  const value = buffer.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new EpubIndexError('LIMIT', 'ZIP value exceeds addressable range')
  return Number(value)
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function readExact(source: EpubByteSource, start: number, length: number): Promise<Buffer> {
  if (length < 0 || start < 0 || start + length > source.size) {
    throw new EpubIndexError('CORRUPT', 'ZIP read outside source bounds')
  }
  if (length === 0) return Buffer.alloc(0)
  const data = await source.read(start, start + length - 1)
  if (data.length !== length) throw new EpubIndexError('CORRUPT', 'Incomplete ZIP read')
  return data
}

interface EndOfCentralDirectory {
  offset: number
  centralOffset: number
  centralSize: number
  entryCount: number
}

async function locateCentralDirectory(source: EpubByteSource): Promise<EndOfCentralDirectory> {
  const tailLength = Math.min(source.size, MAX_TAIL_BYTES)
  const tailStart = source.size - tailLength
  const tail = await readExact(source, tailStart, tailLength)
  let eocdIndex = -1
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
      const commentLength = tail.readUInt16LE(i + 20)
      if (i + 22 + commentLength <= tail.length) {
        eocdIndex = i
        break
      }
    }
  }
  if (eocdIndex < 0) throw new EpubIndexError('CORRUPT', 'ZIP end-of-central-directory not found')

  let offset = tailStart + eocdIndex
  let centralSize = tail.readUInt32LE(eocdIndex + 12)
  let centralOffset = tail.readUInt32LE(eocdIndex + 16)
  let entryCount = tail.readUInt16LE(eocdIndex + 10)

  if (offset >= 20) {
    const locator = await readExact(source, offset - 20, 20)
    if (locator.readUInt32LE(0) === ZIP64_LOCATOR_SIGNATURE) {
      const zip64Offset = readUInt64(locator, 8)
      const zip64 = await readExact(source, zip64Offset, 56)
      if (zip64.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
        throw new EpubIndexError('CORRUPT', 'ZIP64 end-of-central-directory is invalid')
      }
      entryCount = readUInt64(zip64, 32)
      centralSize = readUInt64(zip64, 40)
      centralOffset = readUInt64(zip64, 48)
      offset = zip64Offset
    }
  }

  if (centralSize > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new EpubIndexError('LIMIT', 'ZIP central directory exceeds the reader limit')
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new EpubIndexError('LIMIT', 'ZIP contains too many entries')
  }
  if (centralOffset + centralSize > source.size) {
    throw new EpubIndexError('CORRUPT', 'ZIP central directory lies outside the archive')
  }
  return { offset, centralOffset, centralSize, entryCount }
}

interface Zip64Extra {
  uncompressedSize?: number
  compressedSize?: number
  localHeaderOffset?: number
}

function parseZip64Extra(extra: Buffer, needs: { uncompressed: boolean; compressed: boolean; offset: boolean }): Zip64Extra {
  let cursor = 0
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor)
    const size = extra.readUInt16LE(cursor + 2)
    const dataStart = cursor + 4
    const dataEnd = dataStart + size
    if (dataEnd > extra.length) break
    if (id === 0x0001) {
      let field = dataStart
      const result: Zip64Extra = {}
      if (needs.uncompressed && field + 8 <= dataEnd) {
        result.uncompressedSize = readUInt64(extra, field)
        field += 8
      }
      if (needs.compressed && field + 8 <= dataEnd) {
        result.compressedSize = readUInt64(extra, field)
        field += 8
      }
      if (needs.offset && field + 8 <= dataEnd) {
        result.localHeaderOffset = readUInt64(extra, field)
      }
      return result
    }
    cursor = dataEnd
  }
  return {}
}

function parseCentralDirectory(buffer: Buffer): EpubIndexEntry[] {
  const entries: EpubIndexEntry[] = []
  let cursor = 0
  while (cursor + 46 <= buffer.length) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new EpubIndexError('CORRUPT', 'Invalid ZIP central-directory entry')
    }
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const crc32 = buffer.readUInt32LE(cursor + 16)
    let compressedSize = buffer.readUInt32LE(cursor + 20)
    let size = buffer.readUInt32LE(cursor + 24)
    let localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const nameStart = cursor + 46
    const extraStart = nameStart + nameLength
    const dataEnd = extraStart + extraLength + commentLength
    if (dataEnd > buffer.length) throw new EpubIndexError('CORRUPT', 'Truncated ZIP central-directory entry')

    if (size === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      const zip64 = parseZip64Extra(buffer.subarray(extraStart, extraStart + extraLength), {
        uncompressed: size === 0xffffffff,
        compressed: compressedSize === 0xffffffff,
        offset: localHeaderOffset === 0xffffffff,
      })
      size = zip64.uncompressedSize ?? size
      compressedSize = zip64.compressedSize ?? compressedSize
      localHeaderOffset = zip64.localHeaderOffset ?? localHeaderOffset
    }

    const rawName = decodeZipName(buffer.subarray(nameStart, extraStart), flags)
    const path = normalizeReaderEntryPath(rawName)
    // Directory records and unsafe paths never become reader entries. A
    // traversal entry is not a usable resource, and keeping it would only make
    // the lookup surface larger.
    if (path && !rawName.endsWith('/')) {
      const compression = method === 0 ? 'store' : method === 8 ? 'deflate' : 'unsupported'
      entries.push({ path, size, compressedSize, compression, method, flags, crc32, localHeaderOffset })
    }
    cursor = dataEnd
  }
  return entries
}

export async function openEpubArchive(source: EpubByteSource): Promise<EpubArchive> {
  const eocd = await locateCentralDirectory(source)
  const directory = await readExact(source, eocd.centralOffset, eocd.centralSize)
  const entries = parseCentralDirectory(directory)
  const byPath = new Map<string, EpubIndexEntry | null>()
  const byLowerPath = new Map<string, EpubIndexEntry | null>()
  for (const entry of entries) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry)
    else byPath.set(entry.path, null)
    const lower = entry.path.toLowerCase()
    if (!byLowerPath.has(lower)) byLowerPath.set(lower, entry)
    else byLowerPath.set(lower, null)
  }
  return { source, centralDirectoryOffset: eocd.centralOffset, entries, byPath, byLowerPath }
}

export function lookupArchiveEntry(archive: EpubArchive, rawPath: string): EpubIndexEntry | null {
  const path = normalizeReaderEntryPath(rawPath)
  if (!path) return null
  const exact = archive.byPath.get(path)
  if (exact !== undefined) return exact
  return archive.byLowerPath.get(path.toLowerCase()) ?? null
}

export function decodeArchiveText(bytes: Buffer): string {
  let text: string
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = bytes.subarray(2).toString('utf16le')
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.alloc(Math.max(0, bytes.length - 2))
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      swapped[i - 2] = bytes[i + 1] ?? 0
      swapped[i - 1] = bytes[i] ?? 0
    }
    text = swapped.toString('utf16le')
  } else {
    text = bytes.toString('utf8')
  }
  return text
    .replace(/^\uFEFF/, '')
    // The transport normalizes text to UTF-8. Leaving an old UTF-16 declaration
    // would make the browser decode the new bytes with the old encoding.
    .replace(/^(\s*<\?xml[^>]*?encoding\s*=\s*["'])[^"']+(["'])/i, '$1utf-8$2')
}

export async function readArchiveEntryBuffer(
  archive: EpubArchive,
  entry: EpubIndexEntry,
  maxBytes = READER_ENTRY_MAX_BYTES,
): Promise<Buffer> {
  if (entry.flags & 0x1) throw new EpubIndexError('UNSUPPORTED', 'Encrypted ZIP entries are not supported')
  if (entry.compression === 'unsupported') throw new EpubIndexError('UNSUPPORTED', 'Unsupported ZIP compression method')
  if (entry.size > maxBytes) throw new EpubIndexError('LIMIT', 'ZIP entry exceeds the reader limit')
  if (entry.compressedSize > READER_ENTRY_MAX_BYTES) throw new EpubIndexError('LIMIT', 'ZIP compressed entry exceeds the reader limit')
  if (entry.method === 0 && entry.compressedSize !== entry.size) {
    throw new EpubIndexError('CORRUPT', 'Stored ZIP entry sizes do not match')
  }
  if (entry.localHeaderOffset + 30 > archive.source.size) {
    throw new EpubIndexError('CORRUPT', 'ZIP local header lies outside the archive')
  }
  const header = await readExact(archive.source, entry.localHeaderOffset, 30)
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new EpubIndexError('CORRUPT', 'Invalid ZIP local header')
  if (header.readUInt16LE(8) !== entry.method) throw new EpubIndexError('CORRUPT', 'ZIP local compression does not match its index')
  const nameLength = header.readUInt16LE(26)
  const extraLength = header.readUInt16LE(28)
  const localName = await readExact(archive.source, entry.localHeaderOffset + 30, nameLength)
  if (normalizeReaderEntryPath(decodeZipName(localName, header.readUInt16LE(6))) !== entry.path) {
    throw new EpubIndexError('CORRUPT', 'ZIP local entry name does not match its index')
  }
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength
  if (dataStart + entry.compressedSize > archive.centralDirectoryOffset) {
    throw new EpubIndexError('CORRUPT', 'ZIP entry data overlaps the central directory')
  }
  const compressed = await readExact(archive.source, dataStart, entry.compressedSize)
  let data: Buffer
  if (entry.method === 0) {
    data = compressed
  } else if (entry.method === 8) {
    try {
      data = inflateRawSync(compressed, { maxOutputLength: Math.max(1, Math.min(maxBytes, entry.size || maxBytes)) })
    } catch (error) {
      throw new EpubIndexError('CORRUPT', `ZIP deflate entry failed: ${String(error)}`)
    }
  } else {
    throw new EpubIndexError('UNSUPPORTED', 'Unsupported ZIP compression method')
  }
  if (data.length !== entry.size) {
    throw new EpubIndexError('CORRUPT', 'ZIP entry size does not match its central-directory record')
  }
  if (data.length > maxBytes) throw new EpubIndexError('LIMIT', 'ZIP entry exceeds the reader limit')
  if (crc32(data) !== entry.crc32) throw new EpubIndexError('CORRUPT', 'ZIP entry checksum does not match its central-directory record')
  return data
}

export async function readArchiveText(
  archive: EpubArchive,
  rawPath: string,
  maxBytes = READER_ENTRY_MAX_BYTES,
): Promise<string | null> {
  const entry = lookupArchiveEntry(archive, rawPath)
  if (!entry) return null
  return decodeArchiveText(await readArchiveEntryBuffer(archive, entry, maxBytes))
}

function childElements(root: XmlElement): XmlElement[] {
  return Array.from(root.childNodes).filter((node) => node.nodeType === 1) as XmlElement[]
}

function localName(element: XmlElement): string {
  return (element.localName ?? element.tagName.split(':').pop() ?? '').toLowerCase()
}

function childElementsByLocalName(root: XmlElement, name: string): XmlElement[] {
  return childElements(root).filter((element) => localName(element) === name.toLowerCase())
}

function elementsByLocalName(root: { getElementsByTagName: (name: string) => ArrayLike<XmlElement> }, name: string): XmlElement[] {
  return Array.from(root.getElementsByTagName('*')).filter((element) => localName(element) === name.toLowerCase())
}

function firstElement(list: ArrayLike<XmlElement>): XmlElement | null {
  return list.length > 0 ? list[0] ?? null : null
}

function attribute(element: XmlElement, name: string): string | null {
  return element.getAttribute(name)
}

function textOf(element: XmlElement | null): string {
  return element?.textContent?.trim() ?? ''
}

function isMarkupType(mediaType: string): boolean {
  const type = mediaType.trim().toLowerCase().split(';', 1)[0]
  return type === 'application/xhtml+xml' || type === 'text/html'
}

function hasProperty(item: EpubManifestItem, property: string): boolean {
  return item.properties?.split(/\s+/).some((value) => value.toLowerCase() === property) ?? false
}

function collectNcxNavPoints(parent: XmlElement, chapters: EpubTocItem[], level: number): void {
  for (const navPoint of childElementsByLocalName(parent, 'navPoint')) {
    const text = firstElement(elementsByLocalName(navPoint, 'text'))
    const content = firstElement(elementsByLocalName(navPoint, 'content'))
    const label = textOf(text)
    const src = content ? attribute(content, 'src') : null
    if (src) {
      const href = src.split('#')[0]
      if (href) chapters.push({ title: label || href, href, level })
    }
    collectNcxNavPoints(navPoint, chapters, level + 1)
  }
}

function collectNavList(list: XmlElement, chapters: EpubTocItem[], level: number): void {
  for (const item of childElementsByLocalName(list, 'li')) {
    const link = firstElement(childElementsByLocalName(item, 'a'))
    const href = link ? attribute(link, 'href') : null
    if (href) {
      const base = href.split('#')[0]
      if (base) chapters.push({ title: textOf(link) || base, href: base, level })
    }
    for (const nested of childElementsByLocalName(item, 'ol')) collectNavList(nested, chapters, level + 1)
  }
}

async function readStartupFile(
  archive: EpubArchive,
  path: string,
  budget: { used: number; files: ReaderManifestFile[] },
): Promise<string> {
  const entry = lookupArchiveEntry(archive, path)
  if (!entry) throw new EpubIndexError('CORRUPT', `EPUB startup file is missing: ${path}`)
  const remaining = READER_STARTUP_MAX_BYTES - budget.used
  if (remaining <= 0 || entry.size > remaining) {
    throw new EpubIndexError('LIMIT', 'EPUB startup files exceed the reader limit')
  }
  const text = decodeArchiveText(await readArchiveEntryBuffer(archive, entry, remaining))
  budget.used += Buffer.byteLength(text, 'utf8')
  budget.files.push({ path: entry.path, text })
  return text
}

function parseContainerRootfile(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const rootfiles = elementsByLocalName(doc, 'rootfile')
  const rootfile = rootfiles.find((file) => (
    attribute(file, 'media-type')?.trim().toLowerCase().split(';', 1)[0] === 'application/oebps-package+xml'
  )) ?? rootfiles[0]
  return rootfile ? normalizeManifestHref(attribute(rootfile, 'full-path') ?? '') : ''
}

interface ParsedPackage {
  opfPath: string
  spineTocId: string | null
  manifest: EpubManifestItem[]
  spine: ReaderManifestSpineItem[]
}

function parsePackage(opfPath: string, xml: string): ParsedPackage {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const manifest: EpubManifestItem[] = []
  const byId = new Map<string, EpubManifestItem>()
  const manifestRoot = firstElement(elementsByLocalName(doc, 'manifest'))
  if (manifestRoot) {
    for (const element of elementsByLocalName(manifestRoot, 'item')) {
      const id = attribute(element, 'id')
      const href = attribute(element, 'href')
      const mediaType = attribute(element, 'media-type')
      if (!id || !href || !mediaType) continue
      const item: EpubManifestItem = {
        id,
        href: joinManifestPath(opfPath, href),
        mediaType: mediaType.trim().toLowerCase().split(';', 1)[0] ?? mediaType,
        properties: attribute(element, 'properties') ?? undefined,
        mediaOverlay: attribute(element, 'media-overlay') ?? undefined,
      }
      byId.set(id, item)
      manifest.push(item)
    }
  }
  const spineRoot = firstElement(elementsByLocalName(doc, 'spine'))
  const spineTocId = spineRoot ? attribute(spineRoot, 'toc') : null
  const spine: ReaderManifestSpineItem[] = []
  if (spineRoot) {
    for (const itemref of elementsByLocalName(spineRoot, 'itemref')) {
      const item = byId.get(attribute(itemref, 'idref') ?? '')
      if (!item || !isMarkupType(item.mediaType)) continue
      spine.push({
        path: item.href,
        mediaType: item.mediaType,
        linear: (attribute(itemref, 'linear') ?? '').toLowerCase() !== 'no',
      })
    }
  }
  return { opfPath, spineTocId, manifest, spine }
}

async function parseToc(archive: EpubArchive, pkg: ParsedPackage): Promise<EpubTocItem[]> {
  const toc: EpubTocItem[] = []
  const ncx = (pkg.spineTocId ? pkg.manifest.find((item) => item.id === pkg.spineTocId) : undefined)
    ?? pkg.manifest.find((item) => item.mediaType === 'application/x-dtbncx+xml')
  if (ncx) {
    const xml = await readArchiveText(archive, ncx.href, READER_STARTUP_MAX_BYTES)
    if (xml) {
      const doc = new DOMParser().parseFromString(xml, 'application/xml')
      const navMap = firstElement(elementsByLocalName(doc, 'navMap'))
      if (navMap) {
        const entries: EpubTocItem[] = []
        collectNcxNavPoints(navMap, entries, 1)
        toc.push(...entries.map((entry) => ({ ...entry, href: joinManifestPath(ncx.href, entry.href) })))
      }
    }
  }
  if (toc.length === 0) {
    const nav = pkg.manifest.find((item) => isMarkupType(item.mediaType) && hasProperty(item, 'nav'))
    if (nav) {
      const xml = await readArchiveText(archive, nav.href, READER_STARTUP_MAX_BYTES)
      if (xml) {
        const doc = new DOMParser().parseFromString(xml, 'application/xml')
        const navElements = elementsByLocalName(doc, 'nav')
        const tocNav = navElements.find((element) => {
          const type = attribute(element, 'epub:type') ?? attribute(element, 'type') ?? ''
          return type.split(/\s+/).some((value) => value.toLowerCase() === 'toc')
        })
        const entries: EpubTocItem[] = []
        const list = tocNav ? firstElement(elementsByLocalName(tocNav, 'ol')) : null
        if (list) {
          collectNavList(list, entries, 1)
        } else {
          for (const link of elementsByLocalName(tocNav ?? doc, 'a')) {
            const href = attribute(link, 'href')
            if (!href) continue
            const base = href.split('#')[0]
            if (base) entries.push({ title: textOf(link) || base, href: base, level: 1 })
          }
        }
        toc.push(...entries.map((entry) => ({ ...entry, href: joinManifestPath(nav.href, entry.href) })))
      }
    }
  }
  if (toc.length === 0) {
    for (const item of pkg.spine) toc.push({ title: item.path, href: item.path, level: 1 })
  }
  return toc
}

export async function extractEpubStartup(archive: EpubArchive): Promise<EpubStartup> {
  const budget = { used: 0, files: [] as ReaderManifestFile[] }
  const containerPath = lookupArchiveEntry(archive, 'META-INF/container.xml')?.path
  if (!containerPath) throw new EpubIndexError('CORRUPT', 'META-INF/container.xml not found')
  const containerXml = await readStartupFile(archive, containerPath, budget)
  const opfPath = parseContainerRootfile(containerXml)
  if (!opfPath) throw new EpubIndexError('CORRUPT', 'EPUB package document is not declared')
  const opfXml = await readStartupFile(archive, opfPath, budget)
  const pkg = parsePackage(opfPath, opfXml)

  const nav = pkg.manifest.find((item) => isMarkupType(item.mediaType) && hasProperty(item, 'nav'))
  const ncx = (pkg.spineTocId ? pkg.manifest.find((item) => item.id === pkg.spineTocId) : undefined)
    ?? pkg.manifest.find((item) => item.mediaType === 'application/x-dtbncx+xml')

  for (const path of [
    'META-INF/encryption.xml',
    'META-INF/com.apple.ibooks.display-options.xml',
    'META-INF/com.kobobooks.display-options.xml',
    nav?.href,
    ncx?.href,
  ]) {
    if (!path) continue
    if (budget.files.some((file) => file.path === path)) continue
    if (!lookupArchiveEntry(archive, path)) continue
    if (budget.files.length >= MAX_STARTUP_FILES) break
    try {
      await readStartupFile(archive, path, budget)
    } catch {
      // Optional display options and navigation are not allowed to make an
      // otherwise readable book unopenable; core container/OPF failures above
      // remain fatal.
    }
  }

  return {
    startupFiles: budget.files,
    opfPath,
    navPath: nav?.href ?? null,
    ncxPath: ncx?.href ?? null,
    spine: pkg.spine,
    toc: await parseToc(archive, pkg),
    manifest: pkg.manifest,
  }
}
