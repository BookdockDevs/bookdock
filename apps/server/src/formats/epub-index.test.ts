import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'

import { decodeArchiveText, EpubIndexError, extractEpubStartup, lookupArchiveEntry, normalizeReaderEntryPath, openEpubArchive, readArchiveEntryBuffer, readArchiveText, type EpubByteSource } from './epub-index'

function sourceFrom(buffer: Buffer): EpubByteSource {
  return {
    size: buffer.length,
    async read(start, endInclusive) {
      return buffer.subarray(start, endInclusive + 1)
    },
  }
}

async function fixture(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`)
  zip.file('META-INF/com.apple.ibooks.display-options.xml', '<display_options/>')
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
        <item id="img" href="images/cover.png" media-type="image/png"/>
      </manifest>
      <spine>
        <itemref idref="ch1"/>
        <itemref idref="ch2"/>
      </spine>
    </package>`)
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <body><nav epub:type="toc"><ol>
        <li><a href="text/ch1.xhtml">第一章</a></li>
        <li><a href="text/ch2.xhtml">第二章</a>
          <ol><li><a href="text/ch2.xhtml#part">第二部分</a></li></ol>
        </li>
      </ol></nav></body>
    </html>`)
  zip.file('OEBPS/text/ch1.xhtml', '<html><body><p>甲</p></body></html>')
  zip.file('OEBPS/text/ch2.xhtml', '<html><body><p>乙</p></body></html>')
  zip.file('OEBPS/images/cover.png', Buffer.from([1, 2, 3, 4]))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

describe('reader EPUB index', () => {
  it('reads the central directory and extracts OPF startup plus the nav TOC without inflating the whole archive', async () => {
    const archive = await openEpubArchive(sourceFrom(await fixture()))
    expect(archive.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/text/ch1.xhtml',
      'OEBPS/images/cover.png',
    ]))
    expect(archive.entries.find((entry) => entry.path === 'OEBPS/content.opf')?.compression).toBe('deflate')

    const startup = await extractEpubStartup(archive)
    expect(startup.opfPath).toBe('OEBPS/content.opf')
    expect(startup.navPath).toBe('OEBPS/nav.xhtml')
    expect(startup.spine).toEqual([
      { path: 'OEBPS/text/ch1.xhtml', mediaType: 'application/xhtml+xml', linear: true },
      { path: 'OEBPS/text/ch2.xhtml', mediaType: 'application/xhtml+xml', linear: true },
    ])
    expect(startup.toc).toEqual([
      { title: '第一章', href: 'OEBPS/text/ch1.xhtml', level: 1 },
      { title: '第二章', href: 'OEBPS/text/ch2.xhtml', level: 1 },
      { title: '第二部分', href: 'OEBPS/text/ch2.xhtml', level: 2 },
    ])
    expect(startup.startupFiles.map((file) => file.path)).toEqual(expect.arrayContaining([
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'META-INF/com.apple.ibooks.display-options.xml',
    ]))
  })

  it('reads a single entry and resolves case-insensitively without loading siblings', async () => {
    const archive = await openEpubArchive(sourceFrom(await fixture()))
    expect(await readArchiveText(archive, 'oebps/TEXT/ch1.xhtml')).toBe('<html><body><p>甲</p></body></html>')
    const image = lookupArchiveEntry(archive, 'OEBPS/images/cover.png')
    expect(image).not.toBeNull()
    expect(await readArchiveEntryBuffer(archive, image!)).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(lookupArchiveEntry(archive, '../etc/passwd')).toBeNull()
  })

  it('rejects entry bytes that do not match the central-directory checksum', async () => {
    const bytes = Buffer.from(await fixture())
    const valid = await openEpubArchive(sourceFrom(bytes))
    const entry = lookupArchiveEntry(valid, 'OEBPS/images/cover.png')!
    const damaged = Buffer.from(bytes)
    const header = damaged.subarray(entry.localHeaderOffset, entry.localHeaderOffset + 30)
    const dataOffset = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
    damaged[dataOffset] = (damaged[dataOffset] ?? 0) ^ 0xff
    const archive = await openEpubArchive(sourceFrom(damaged))
    await expect(readArchiveEntryBuffer(archive, lookupArchiveEntry(archive, entry.path)!))
      .rejects.toMatchObject({ code: 'CORRUPT' } satisfies Partial<EpubIndexError>)
  })

  it('rejects oversized compressed input before reading its payload', async () => {
    const bytes = Buffer.from(await fixture())
    let cursor = 0
    const targetName = Buffer.from('OEBPS/text/ch1.xhtml')
    while (cursor + 46 <= bytes.length) {
      if (bytes.readUInt32LE(cursor) !== 0x02014b50) { cursor += 1; continue }
      const nameLength = bytes.readUInt16LE(cursor + 28)
      const nameStart = cursor + 46
      if (bytes.subarray(nameStart, nameStart + nameLength).equals(targetName)) {
        bytes.writeUInt32LE(33 * 1024 * 1024, cursor + 20)
        break
      }
      cursor = nameStart + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32)
    }
    const reads: Array<[number, number]> = []
    const boundedSource: EpubByteSource = {
      size: bytes.length,
      async read(start, endInclusive) {
        reads.push([start, endInclusive])
        return bytes.subarray(start, endInclusive + 1)
      },
    }
    const archive = await openEpubArchive(boundedSource)
    const entry = lookupArchiveEntry(archive, 'OEBPS/text/ch1.xhtml')!
    const metadataReads = reads.length
    await expect(readArchiveEntryBuffer(archive, entry)).rejects.toMatchObject({ code: 'LIMIT' } satisfies Partial<EpubIndexError>)
    expect(reads).toHaveLength(metadataReads)
  })

  it('rejects inconsistent stored sizes and entry data overlapping the central directory', async () => {
    const archive = await openEpubArchive(sourceFrom(await fixture()))
    const storedEntry = lookupArchiveEntry(archive, 'mimetype')!
    await expect(readArchiveEntryBuffer(archive, { ...storedEntry, compressedSize: storedEntry.compressedSize + 1 }))
      .rejects.toMatchObject({ code: 'CORRUPT' } satisfies Partial<EpubIndexError>)
    const entry = lookupArchiveEntry(archive, 'OEBPS/images/cover.png')!
    await expect(readArchiveEntryBuffer(archive, {
      ...entry,
      compression: 'deflate',
      method: 8,
      compressedSize: archive.centralDirectoryOffset,
    })).rejects.toMatchObject({ code: 'CORRUPT' } satisfies Partial<EpubIndexError>)
  })

  it('normalizes safe paths and decodes UTF-16 text to UTF-8-safe strings', () => {
    expect(normalizeReaderEntryPath('OEBPS\\text\\c1.xhtml')).toBe('OEBPS/text/c1.xhtml')
    expect(normalizeReaderEntryPath('OEBPS/text/../c1.xhtml')).toBeNull()
    expect(normalizeReaderEntryPath('../outside')).toBeNull()
    expect(normalizeReaderEntryPath('/absolute')).toBeNull()
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<?xml version="1.0" encoding="utf-16"?><p>甲</p>', 'utf16le')])
    expect(decodeArchiveText(utf16)).toBe('<?xml version="1.0" encoding="utf-8"?><p>甲</p>')
  })
})
