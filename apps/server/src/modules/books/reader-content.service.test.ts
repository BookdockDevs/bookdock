import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomFillSync } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import JSZip from 'jszip'
import sharp from 'sharp'

import {
  resetReaderContentCachesForTests,
  setReaderDerivedWriteGateForTests,
  waitForReaderDerivedWritesForTests,
} from './reader-content.service'

const testDataDir = vi.hoisted(() => {
  return `${process.cwd()}\\.tmp-reader-content-${process.pid}-${Date.now()}`
})

vi.mock('../../config', () => ({
  config: { dataDir: testDataDir },
}))

let sourceBuffer = Buffer.alloc(0)
let sourceReadCount = 0
let sourceReadRanges: Array<{ start: number; end: number } | undefined> = []
let sourceRequestedKeys: string[] = []
let sourceExists = true
let sourceReadGate: (() => Promise<void>) | null = null
let failNextSourceRead = false
let fixturePng = Buffer.alloc(0)
let largeFixturePngBytes = 0

vi.mock('../../storage', () => ({
  getStorage: () => ({
    exists: async () => sourceExists,
    size: async () => sourceBuffer.length,
    get: async (key: string, range?: { start: number; end: number }) => {
      sourceReadCount += 1
      sourceReadRanges.push(range)
      sourceRequestedKeys.push(key)
      await sourceReadGate?.()
      if (failNextSourceRead) {
        failNextSourceRead = false
        throw new Error('fixture source read failed')
      }
      const data = range ? sourceBuffer.subarray(range.start, range.end + 1) : sourceBuffer
      return Readable.from([data])
    },
  }),
}))

async function fixture(includeLargeImage = false, includeSecondImage = false, mediaBytes = 0, mediaCompression: 'STORE' | 'DEFLATE' = 'DEFLATE', secondMediaBytes = 0): Promise<Buffer> {
  fixturePng = await sharp({ create: { width: 64, height: 32, channels: 4, background: '#336699' } }).png().toBuffer()
  let chapterImage = fixturePng
  if (includeLargeImage) {
    const pixels = randomFillSync(Buffer.alloc(1024 * 512 * 3))
    chapterImage = await sharp(pixels, { raw: { width: 1024, height: 512, channels: 3 } }).png().toBuffer()
    largeFixturePngBytes = chapterImage.length
  }
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`)
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
        <item id="img" href="images/cover.png" media-type="image/png"/>
        <item id="opaque-image" href="images/cover.asset" media-type="image/png"/>
        ${mediaBytes ? '<item id="audio" href="audio/track.mp3" media-type="audio/mpeg"/>' : ''}
        ${secondMediaBytes ? '<item id="audio-2" href="audio/second.mp3" media-type="audio/mpeg"/>' : ''}
        ${includeSecondImage ? '<item id="second-image" href="images/second.png" media-type="image/png"/>' : ''}
      </manifest>
      <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
    </package>`)
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <body><nav epub:type="toc"><ol>
        <li><a href="text/ch1.xhtml">第一章</a></li>
        <li><a href="text/ch2.xhtml">第二章</a></li>
      </ol></nav></body>
    </html>`)
  zip.file('OEBPS/text/ch1.xhtml', '<html><body><p>甲</p><img src="../images/cover.png" style="width: 100%; object-fit: contain"/><img src="../images/cover.png" width="96"/></body></html>')
  zip.file('OEBPS/text/ch2.xhtml', includeSecondImage
    ? '<html><body><p>乙</p><img src="../images/second.png"/></body></html>'
    : '<html><body><p>乙</p></body></html>')
  zip.file('OEBPS/images/cover.png', chapterImage)
  if (includeSecondImage) zip.file('OEBPS/images/second.png', await sharp({ create: { width: 20, height: 10, channels: 4, background: '#993366' } }).png().toBuffer())
  zip.file('OEBPS/images/cover.asset', Buffer.from([4, 3, 2, 1]))
  if (mediaBytes) zip.file('OEBPS/audio/track.mp3', Buffer.alloc(mediaBytes, 47), { compression: mediaCompression })
  if (secondMediaBytes) zip.file('OEBPS/audio/second.mp3', Buffer.alloc(secondMediaBytes, 48), { compression: mediaCompression })
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

const book = {
  id: 'book-1',
  filePath: 'content/book-1.epub',
  format: 'epub',
  revisionId: 'rev-1',
  contentHash: 'hash-1',
}

describe('shared reader content service', () => {
  beforeEach(async () => {
    await waitForReaderDerivedWritesForTests()
    setReaderDerivedWriteGateForTests(null)
    const { setReaderPrebuildGateForTests, setReaderArchiveOpenGateForTests, waitForReaderPrebuildsForTests } = await import('./reader-content.service')
    await waitForReaderPrebuildsForTests()
    setReaderPrebuildGateForTests(null)
    setReaderArchiveOpenGateForTests(null)
    sourceBuffer = await fixture()
    sourceReadCount = 0
    sourceReadRanges = []
    sourceRequestedKeys = []
    sourceExists = true
    sourceReadGate = null
    failNextSourceRead = false
    resetReaderContentCachesForTests()
    await fs.rm(path.join(testDataDir, 'reader-content-index'), { recursive: true, force: true })
    await fs.rm(path.join(testDataDir, 'reader-media-cache'), { recursive: true, force: true })
  })

  afterAll(async () => {
    await waitForReaderDerivedWritesForTests()
    await fs.rm(testDataDir, { recursive: true, force: true })
  })

  it('returns a manifest derived from the shared index and startup files', async () => {
    const { getReaderManifest, readReaderEntry, loadReaderChapterMarkup } = await import('./reader-content.service')
    const manifest = await getReaderManifest({ ...book, size: sourceBuffer.length })
    expect(manifest.formatVersion).toBe(1)
    expect(manifest.revisionId).toBe('rev-1')
    expect(manifest.opfPath).toBe('OEBPS/content.opf')
    expect(manifest.navPath).toBe('OEBPS/nav.xhtml')
    expect(manifest.entryCount).toBe(manifest.entries.length)
    expect(manifest.entries.find((entry) => entry.path === 'OEBPS/images/cover.png')?.mediaType).toBe('image/png')
    expect(manifest.startupFiles.find((file) => file.path === 'OEBPS/content.opf')?.text).toContain('package')
    expect(manifest.spine.map((item) => item.path)).toEqual([
      'OEBPS/text/ch1.xhtml',
      'OEBPS/text/ch2.xhtml',
    ])

    const entry = await readReaderEntry({ ...book, size: sourceBuffer.length }, 'oebps/text/ch1.xhtml')
    expect(entry?.mediaType).toBe('application/xhtml+xml')
    expect(entry?.data.toString('utf8')).toContain('甲')

    const chapter = await loadReaderChapterMarkup({ ...book, size: sourceBuffer.length }, 1)
    expect(chapter?.href).toBe('OEBPS/text/ch2.xhtml')
    expect(chapter?.markup).toContain('乙')
  })

  it('returns per-item errors for a batch without failing successful items', async () => {
    const { readReaderTextBatch } = await import('./reader-content.service')
    const result = await readReaderTextBatch({ ...book, size: sourceBuffer.length }, [
      'OEBPS/text/ch1.xhtml',
      'OEBPS/images/cover.png',
      'OEBPS/missing.xhtml',
    ])
    expect(result.revisionId).toBe('rev-1')
    expect(result.items[0]).toMatchObject({ path: 'OEBPS/text/ch1.xhtml', bytes: expect.any(Number) })
    expect(result.items[1]).toEqual({ path: 'OEBPS/images/cover.png', error: 'READER_ENTRY_UNSUPPORTED' })
    expect(result.items[2]).toEqual({ path: 'OEBPS/missing.xhtml', error: 'READER_ENTRY_NOT_FOUND' })
    expect(result.items[0]).toMatchObject({
      resources: [{ path: 'OEBPS/images/cover.png', width: 64, height: 32 }],
    })
    const markup = 'text' in result.items[0] ? result.items[0].text : ''
    expect(markup).toContain('width: 100%; object-fit: contain; aspect-ratio: 64 / 32;')
    expect(markup).toContain('width="96"')
    expect(markup).not.toMatch(/<img[^>]+width="64"[^>]+height="32"/)
    expect(markup).not.toMatch(/<img[^>]*\sheight=/)
  })

  it('returns chapter layout dimensions without loading image dimensions from unrelated chapters', async () => {
    const { readReaderEntryForWeb } = await import('./reader-content.service')
    const result = await readReaderEntryForWeb({ ...book, size: sourceBuffer.length }, 'OEBPS/text/ch1.xhtml')

    expect(result?.resources).toEqual([{ path: 'OEBPS/images/cover.png', width: 64, height: 32 }])
    const markup = result?.data.toString('utf8') ?? ''
    expect(markup).toContain('width: 100%; object-fit: contain; aspect-ratio: 64 / 32;')
    expect(markup).toContain('width="96"')
    expect(markup).not.toMatch(/<img[^>]+width="64"[^>]+height="32"/)
    expect(markup).not.toMatch(/<img[^>]*\sheight=/)
    expect(markup).toContain('src="../images/cover.png"')
    await vi.waitFor(async () => expect(await fs.readdir(path.join(testDataDir, 'reader-content-index', 'v3'))).not.toHaveLength(0))
    const derived = JSON.parse(await fs.readFile(
      path.join(testDataDir, 'reader-content-index', 'v3', (await fs.readdir(path.join(testDataDir, 'reader-content-index', 'v3')))[0]!),
      'utf8',
    )) as { imageDimensions: Record<string, { width: number; height: number }> }
    expect(derived.imageDimensions['OEBPS/images/cover.png']).toEqual({ width: 64, height: 32 })

    const sourceReadsAfterDimensions = sourceReadCount
    const { resetReaderContentCachesForTests } = await import('./reader-content.service')
    resetReaderContentCachesForTests()
    const reopened = await readReaderEntryForWeb({ ...book, size: sourceBuffer.length }, 'OEBPS/text/ch1.xhtml')
    expect(reopened?.resources).toEqual([{ path: 'OEBPS/images/cover.png', width: 64, height: 32 }])
    expect(sourceReadCount - sourceReadsAfterDimensions).toBe(3)
  })

  it('skips image dimension preparation when the reader request excludes resource dimensions', async () => {
    const { getReaderManifest, readReaderEntryForWeb, readReaderTextBatch } = await import('./reader-content.service')
    const content = { ...book, size: sourceBuffer.length }
    await getReaderManifest(content)
    sourceReadCount = 0

    const entry = await readReaderEntryForWeb(content, 'OEBPS/text/ch1.xhtml', false)
    expect(entry?.resources).toEqual([])
    expect(entry?.data.toString('utf8')).not.toContain('aspect-ratio:')
    expect(sourceReadCount).toBe(3)

    const batch = await readReaderTextBatch(content, ['OEBPS/text/ch1.xhtml'], false)
    expect(batch.items[0]).toMatchObject({ path: 'OEBPS/text/ch1.xhtml', text: expect.not.stringContaining('aspect-ratio:') })
    expect(batch.items[0]).not.toHaveProperty('resources')
    expect(sourceReadCount).toBe(3)
  })

  it('keeps layout dimensions for a large compressed chapter image outside the small-image prefetch budget', async () => {
    sourceBuffer = await fixture(true)
    sourceReadCount = 0
    resetReaderContentCachesForTests()
    expect(largeFixturePngBytes).toBeGreaterThan(512 * 1024)

    const { readReaderEntryForWeb } = await import('./reader-content.service')
    const result = await readReaderEntryForWeb({ ...book, size: sourceBuffer.length }, 'OEBPS/text/ch1.xhtml')

    expect(result?.resources).toEqual([{ path: 'OEBPS/images/cover.png', width: 1024, height: 512 }])
    expect(result?.data.toString('utf8')).toContain('aspect-ratio: 1024 / 512;')
  })

  it('returns chapter text while derived persistence is blocked and persists dimensions added during the write', async () => {
    sourceBuffer = await fixture(false, true)
    sourceReadCount = 0
    resetReaderContentCachesForTests()
    let releaseWrite!: () => void
    let notifyWriteStarted!: () => void
    const writeStarted = new Promise<void>((resolve) => { notifyWriteStarted = resolve })
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    setReaderDerivedWriteGateForTests(async () => {
      notifyWriteStarted()
      await writeGate
    })
    const { getReaderManifest, readReaderEntryForWeb } = await import('./reader-content.service')

    await getReaderManifest({ ...book, size: sourceBuffer.length })
    try {
      await writeStarted
      const first = await readReaderEntryForWeb({ ...book, size: sourceBuffer.length }, 'OEBPS/text/ch1.xhtml')
      const second = await readReaderEntryForWeb({ ...book, size: sourceBuffer.length }, 'OEBPS/text/ch2.xhtml')
      expect(first?.data.toString('utf8')).toContain('aspect-ratio: 64 / 32;')
      expect(second?.data.toString('utf8')).toContain('aspect-ratio: 20 / 10;')

      releaseWrite()
      await waitForReaderDerivedWritesForTests()
      const indexDirectory = path.join(testDataDir, 'reader-content-index', 'v3')
      const names = await fs.readdir(indexDirectory)
      const saved = JSON.parse(await fs.readFile(path.join(indexDirectory, names[0]!), 'utf8')) as { imageDimensions: Record<string, unknown> }
      expect(saved.imageDimensions).toMatchObject({
        'OEBPS/images/cover.png': { width: 64, height: 32 },
        'OEBPS/images/second.png': { width: 20, height: 10 },
      })
    } finally {
      releaseWrite()
      setReaderDerivedWriteGateForTests(null)
      await waitForReaderDerivedWritesForTests()
    }
  })

  it('does not make a failed derived write block online chapter content', async () => {
    sourceBuffer = await fixture()
    sourceReadCount = 0
    resetReaderContentCachesForTests()
    const indexRoot = path.join(testDataDir, 'reader-content-index')
    await fs.mkdir(indexRoot, { recursive: true })
    await fs.writeFile(path.join(indexRoot, 'v3'), 'not a directory')
    const { getReaderManifest, readReaderEntryForWeb } = await import('./reader-content.service')

    await expect(getReaderManifest({ ...book, size: sourceBuffer.length })).resolves.toMatchObject({ entryCount: expect.any(Number) })
    const chapter = await readReaderEntryForWeb({ ...book, size: sourceBuffer.length }, 'OEBPS/text/ch1.xhtml')
    expect(chapter?.data.toString('utf8')).toContain('甲')
    await waitForReaderDerivedWritesForTests()
  })

  it('serves both Web and Legado from the same raw-entry hot cache', async () => {
    const { readReaderEntry, loadReaderEpubResource } = await import('./reader-content.service')
    const content = { ...book, size: sourceBuffer.length }
    const webResource = await readReaderEntry(content, 'OEBPS/images/cover.png')
    const readsAfterWebEntry = sourceReadCount
    const resource = await loadReaderEpubResource(content, 'OEBPS/images/cover.png')
    expect(resource?.mediaType).toBe('image/png')
    expect(webResource?.data).toEqual(fixturePng)
    expect(resource?.data).toEqual(webResource?.data)
    expect(sourceReadCount).toBe(readsAfterWebEntry)
  })

  it('keeps Legado user projections outside the shared Web and raw-entry cache', async () => {
    const { loadReaderChapterMarkup } = await import('./reader-content.service')
    const { projectEpubChapterMarkup } = await import('./legado.service')
    const content = { ...book, size: sourceBuffer.length }
    const webMarkup = await loadReaderChapterMarkup(content, 0)
    expect(webMarkup?.markup).toContain('甲')
    const readsAfterWeb = sourceReadCount
    const projection = (replacement: string) => projectEpubChapterMarkup(webMarkup!.markup, [{
      id: `rule-${replacement}`,
      matchType: 'pattern',
      pattern: '甲',
      replacement,
      isRegex: false,
      applyTo: 'content',
      effectiveEnabled: true,
      spineHref: null,
      textOffset: null,
      originalText: null,
    }], webMarkup!.href)

    const firstUser = projection('用户甲')
    const secondUser = projection('用户乙')
    const rawAgain = await loadReaderChapterMarkup(content, 0)

    expect(firstUser).toContain('用户甲')
    expect(firstUser).not.toContain('用户乙')
    expect(secondUser).toContain('用户乙')
    expect(secondUser).not.toContain('用户甲')
    expect(rawAgain?.markup).toContain('甲')
    expect(rawAgain?.markup).not.toContain('用户甲')
    expect(sourceReadCount).toBe(readsAfterWeb)
  })

  it('uses OPF declared media types and reuses a validated disk index after a process cache reset', async () => {
    const { getReaderManifest, readReaderEntry, resetReaderContentCachesForTests } = await import('./reader-content.service')
    const content = { ...book, size: sourceBuffer.length }
    const manifest = await getReaderManifest(content)
    expect(manifest.entries.find((entry) => entry.path === 'OEBPS/images/cover.asset')?.mediaType).toBe('image/png')
    expect((await readReaderEntry(content, 'OEBPS/images/cover.asset'))?.mediaType).toBe('image/png')
    const sourceReadsAfterBuild = sourceReadCount
    const indexDirectory = path.join(testDataDir, 'reader-content-index', 'v3')
    await vi.waitFor(async () => expect(await fs.readdir(indexDirectory)).not.toHaveLength(0))
    const indexPath = path.join(indexDirectory, (await fs.readdir(indexDirectory))[0]!)

    resetReaderContentCachesForTests()
    await getReaderManifest(content)
    expect(sourceReadCount).toBe(sourceReadsAfterBuild)

    await fs.writeFile(indexPath, JSON.stringify({ version: 2, blobKey: book.filePath, sourceSize: sourceBuffer.length, entries: [null], startup: { startupFiles: [] }, imageDimensions: {} }))
    resetReaderContentCachesForTests()
    const rebuilt = await getReaderManifest(content)
    expect(rebuilt.entries).toHaveLength(manifest.entries.length)
    expect(sourceReadCount).toBeGreaterThan(sourceReadsAfterBuild)
  })

  it.each(['STORE', 'DEFLATE'] as const)('streams and caches %s media above the ordinary 32 MiB entry limit', async (compression) => {
    const { acquireReaderMedia } = await import('./reader-media.service')
    const bytes = 33 * 1024 * 1024 + 17
    sourceBuffer = await fixture(false, false, bytes, compression)
    resetReaderContentCachesForTests()
    const media = await acquireReaderMedia({ ...book, size: sourceBuffer.length }, 'OEBPS/audio/track.mp3')
    const payload: Buffer[] = []
    for await (const chunk of media.createStream({ start: 101, end: 108 })) payload.push(Buffer.from(chunk))
    expect(Buffer.concat(payload)).toEqual(Buffer.alloc(8, 47))
    expect(media.size).toBe(bytes)
    expect(media.mediaType).toBe('audio/mpeg')
    await media.release()
    const cacheDirectory = path.join(testDataDir, 'reader-media-cache', 'v1')
    expect((await fs.readdir(cacheDirectory)).filter((name) => name.endsWith('.media'))).toHaveLength(1)
  }, 30_000)

  it('coalesces concurrent media preparation and removes failed temporary output for retry', async () => {
    const { acquireReaderMedia } = await import('./reader-media.service')
    sourceBuffer = await fixture(false, false, 2 * 1024 * 1024, 'DEFLATE')
    resetReaderContentCachesForTests()
    const cacheDirectory = path.join(testDataDir, 'reader-media-cache', 'v1')
    await fs.mkdir(cacheDirectory, { recursive: true })
    const orphan = path.join(cacheDirectory, `${'c'.repeat(64)}.media.tmp-deadbeef`)
    await fs.writeFile(orphan, 'stale')
    const content = { ...book, contentHash: 'isolated-concurrent-media', size: sourceBuffer.length }
    const [first, second] = await Promise.all([
      acquireReaderMedia(content, 'OEBPS/audio/track.mp3'),
      acquireReaderMedia(content, 'OEBPS/audio/track.mp3'),
    ])
    expect(first.file).toBe(second.file)
    expect(await fs.stat(orphan).then(() => true, () => false)).toBe(false)
    expect((await fs.readdir(path.dirname(first.file))).filter((name) => name.includes('.tmp-'))).toHaveLength(0)
    await first.release()
    await second.release()
    await fs.unlink(first.file)

    const broken = Buffer.from(sourceBuffer)
    const name = Buffer.from('OEBPS/audio/track.mp3')
    const headerOffset = broken.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    let cursor = headerOffset
    let dataOffset = -1
    while (cursor >= 0) {
      const nameLength = broken.readUInt16LE(cursor + 26)
      const extraLength = broken.readUInt16LE(cursor + 28)
      const localName = broken.subarray(cursor + 30, cursor + 30 + nameLength)
      if (localName.equals(name)) { dataOffset = cursor + 30 + nameLength + extraLength; break }
      cursor = broken.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), cursor + 4)
    }
    expect(dataOffset).toBeGreaterThan(0)
    broken[dataOffset] = (broken[dataOffset]! ^ 0xff)
    sourceBuffer = broken
    resetReaderContentCachesForTests()
    await expect(acquireReaderMedia(content, 'OEBPS/audio/track.mp3')).rejects.toThrow()
    expect((await fs.readdir(path.dirname(first.file))).filter((file) => file.includes('.tmp-'))).toHaveLength(0)
    sourceBuffer = await fixture(false, false, 2 * 1024 * 1024, 'DEFLATE')
    resetReaderContentCachesForTests()
    const retried = await acquireReaderMedia({ ...book, size: sourceBuffer.length }, 'OEBPS/audio/track.mp3')
    expect(retried.size).toBe(2 * 1024 * 1024)
    await retried.release()
  }, 30_000)

  it('serializes distinct media preparations and aborts an abandoned preparation', async () => {
    const { acquireReaderMedia } = await import('./reader-media.service')
    sourceBuffer = await fixture(false, false, 2 * 1024 * 1024, 'DEFLATE', 2 * 1024 * 1024)
    resetReaderContentCachesForTests()
    const content = { ...book, size: sourceBuffer.length }
    await (await import('./reader-content.service')).getReaderManifest(content)
    let releaseRead!: () => void
    let enteredReads = 0
    sourceReadGate = () => {
      enteredReads += 1
      if (enteredReads === 1) return new Promise<void>((resolve) => { releaseRead = resolve })
      return Promise.resolve()
    }
    const first = acquireReaderMedia(content, 'OEBPS/audio/track.mp3')
    await vi.waitFor(() => expect(enteredReads).toBe(1))
    const second = acquireReaderMedia(content, 'OEBPS/audio/second.mp3')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(enteredReads).toBe(1)
    releaseRead()
    const [firstLease, secondLease] = await Promise.all([first, second])
    expect(enteredReads).toBeGreaterThan(1)
    await firstLease.release()
    await secondLease.release()
    sourceReadGate = null

    sourceBuffer = await fixture(false, false, 2 * 1024 * 1024, 'DEFLATE')
    resetReaderContentCachesForTests()
    const abandonedContent = { ...book, contentHash: 'isolated-abandoned-media', size: sourceBuffer.length }
    await (await import('./reader-content.service')).getReaderManifest(abandonedContent)
    let releaseAbortedRead!: () => void
    let blockAbortedRead = true
    let abortedSourceReads = 0
    sourceReadGate = () => {
      abortedSourceReads += 1
      if (!blockAbortedRead) return Promise.resolve()
      blockAbortedRead = false
      return new Promise<void>((resolve) => { releaseAbortedRead = resolve })
    }
    const controller = new AbortController()
    const abandoned = acquireReaderMedia(abandonedContent, 'OEBPS/audio/track.mp3', controller.signal)
    await vi.waitFor(() => expect(releaseAbortedRead).toBeTypeOf('function'))
    controller.abort(new DOMException('Request disconnected', 'AbortError'))
    await expect(abandoned).rejects.toThrow('Request disconnected')
    const retry = acquireReaderMedia(abandonedContent, 'OEBPS/audio/track.mp3')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(abortedSourceReads).toBe(1)
    releaseAbortedRead()
    const retried = await retry
    expect(abortedSourceReads).toBeGreaterThan(1)
    await retried.release()
    sourceReadGate = null
    const cacheDirectory = path.join(testDataDir, 'reader-media-cache', 'v1')
    expect((await fs.readdir(cacheDirectory)).filter((name) => name.includes('.tmp-'))).toHaveLength(0)
  }, 30_000)

  it('evicts least-recent media cache files and protects active transfers', async () => {
    const { acquireReaderMedia, setReaderMediaCacheBudgetForTests } = await import('./reader-media.service')
    const directory = path.join(testDataDir, 'reader-media-cache', 'v1')
    await fs.mkdir(directory, { recursive: true })
    const oldest = path.join(directory, `${'a'.repeat(64)}.media`)
    const newest = path.join(directory, `${'b'.repeat(64)}.media`)
    await fs.writeFile(oldest, Buffer.alloc(4))
    await fs.writeFile(newest, Buffer.alloc(4))
    await fs.utimes(oldest, new Date(1), new Date(1))
    await fs.utimes(newest, new Date(2), new Date(2))
    await setReaderMediaCacheBudgetForTests(4)
    expect(await fs.stat(oldest).then(() => true, () => false)).toBe(false)
    expect(await fs.stat(newest).then(() => true, () => false)).toBe(true)
    await setReaderMediaCacheBudgetForTests(null)
    sourceBuffer = await fixture(false, false, 12, 'STORE')
    resetReaderContentCachesForTests()
    const media = await acquireReaderMedia({ ...book, size: sourceBuffer.length }, 'OEBPS/audio/track.mp3')
    await setReaderMediaCacheBudgetForTests(0)
    expect(await fs.stat(media.file).then(() => true, () => false)).toBe(true)
    const stream = media.createStream()
    const closed = new Promise<void>((resolve) => stream.once('close', resolve))
    stream.destroy()
    await closed
    await media.release()
    await setReaderMediaCacheBudgetForTests(0)
    expect(await fs.stat(media.file).then(() => true, () => false)).toBe(false)
    await setReaderMediaCacheBudgetForTests(null)
  })

  it('shares prepared and raw caches by immutable content hash across book revisions', async () => {
    const { getReaderManifest, readReaderEntry } = await import('./reader-content.service')
    const original = { ...book, size: sourceBuffer.length }
    const firstManifest = await getReaderManifest(original)
    const firstEntry = await readReaderEntry(original, 'OEBPS/text/ch1.xhtml')
    const readsBeforeReuse = sourceReadCount
    const nextRevision = {
      ...original,
      id: 'book-2',
      filePath: 'content/deduplicated-book-2.epub',
      revisionId: 'rev-2',
    }

    const nextManifest = await getReaderManifest(nextRevision)
    const nextEntry = await readReaderEntry(nextRevision, 'OEBPS/text/ch1.xhtml')

    expect(nextManifest).toMatchObject({ bookId: 'book-2', revisionId: 'rev-2', contentHash: firstManifest.contentHash })
    expect(nextEntry?.data).toEqual(firstEntry?.data)
    expect(sourceReadCount).toBe(readsBeforeReuse)
  })

  it('shares one raw read across callers with different valid limits and retries a failed read', async () => {
    const { getReaderManifest, readReaderEntry } = await import('./reader-content.service')
    const content = { ...book, size: sourceBuffer.length }
    const manifest = await getReaderManifest(content)
    const entry = manifest.entries.find((item) => item.path === 'OEBPS/text/ch1.xhtml')!
    const readCountBefore = sourceReadCount
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const began = new Promise<void>((resolve) => { started = resolve })
    sourceReadGate = async () => { started(); await gate }

    const boundedRead = readReaderEntry(content, entry.path, entry.size + 64)
    await began
    const widerRead = readReaderEntry(content, entry.path, entry.size + 4096)
    await expect(readReaderEntry(content, entry.path, entry.size - 1)).rejects.toThrow('READER_ENTRY_TOO_LARGE')
    release()
    const [bounded, wider] = await Promise.all([boundedRead, widerRead])
    sourceReadGate = null
    expect(bounded?.data).toEqual(wider?.data)
    expect(sourceReadCount - readCountBefore).toBe(3)
    let releaseFailure!: () => void
    let startedFailure!: () => void
    const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve })
    const failureBegan = new Promise<void>((resolve) => { startedFailure = resolve })
    sourceReadGate = async () => { startedFailure(); await failureGate }
    failNextSourceRead = true
    const failedRead = readReaderEntry(content, 'OEBPS/text/ch2.xhtml', 4096)
    await failureBegan
    const joinedFailure = readReaderEntry(content, 'OEBPS/text/ch2.xhtml', 8192)
    releaseFailure()
    await expect(Promise.all([failedRead, joinedFailure])).rejects.toThrow()
    sourceReadGate = null
    await expect(readReaderEntry(content, 'OEBPS/text/ch2.xhtml', 8192)).resolves.toBeTruthy()
  })

  it('prepares one immutable source once and shares an in-flight build with a foreground read', async () => {
    const {
      enqueueReaderArchivePreparation,
      getReaderManifest,
      getReaderPrebuildQueueStateForTests,
      setReaderArchiveOpenGateForTests,
      waitForReaderPrebuildsForTests,
    } = await import('./reader-content.service')
    let releaseOpen!: () => void
    let notifyOpen!: () => void
    let openCount = 0
    const openGate = new Promise<void>((resolve) => { releaseOpen = resolve })
    const openStarted = new Promise<void>((resolve) => { notifyOpen = resolve })
    setReaderArchiveOpenGateForTests(async () => {
      openCount += 1
      notifyOpen()
      await openGate
    })
    const source = { ...book, size: sourceBuffer.length }
    expect(enqueueReaderArchivePreparation(source)).toBe('queued')
    await openStarted

    const foreground = getReaderManifest(source)
    await vi.waitFor(() => expect(getReaderPrebuildQueueStateForTests().active).toBe(1))
    releaseOpen()
    await expect(foreground).resolves.toMatchObject({ revisionId: 'rev-1' })
    await waitForReaderPrebuildsForTests()
    expect(openCount).toBe(1)
    expect(sourceReadRanges.every((range) => range !== undefined)).toBe(true)
    expect(enqueueReaderArchivePreparation({ ...source, revisionId: 'rev-2' })).toBe('deduplicated')
  })

  it('bounds pending prebuilds, runs one worker, and skips a full queue without throwing', async () => {
    const {
      enqueueReaderArchivePreparation,
      getReaderPrebuildQueueStateForTests,
      setReaderPrebuildGateForTests,
      waitForReaderPrebuildsForTests,
    } = await import('./reader-content.service')
    let releaseWorker!: () => void
    let notifyWorker!: () => void
    const workerGate = new Promise<void>((resolve) => { releaseWorker = resolve })
    const workerStarted = new Promise<void>((resolve) => { notifyWorker = resolve })
    setReaderPrebuildGateForTests(async () => {
      notifyWorker()
      await workerGate
    })
    expect(enqueueReaderArchivePreparation({ ...book, size: sourceBuffer.length })).toBe('queued')
    await workerStarted
    for (let index = 0; index < 32; index += 1) {
      expect(enqueueReaderArchivePreparation({
        ...book,
        id: `book-${index + 2}`,
        filePath: `content/book-${index + 2}.epub`,
        contentHash: `hash-${index + 2}`,
        revisionId: `rev-${index + 2}`,
      })).toBe('queued')
    }
    expect(enqueueReaderArchivePreparation({
      ...book,
      id: 'book-overflow',
      filePath: 'content/book-overflow.epub',
      contentHash: 'hash-overflow',
      revisionId: 'rev-overflow',
    })).toBe('skipped')
    expect(getReaderPrebuildQueueStateForTests()).toEqual({ queued: 32, active: 1 })
    releaseWorker()
    await waitForReaderPrebuildsForTests()
    expect(getReaderPrebuildQueueStateForTests()).toEqual({ queued: 0, active: 0 })
  })

  it('skips a missing source as a handled background failure', async () => {
    const { enqueueReaderArchivePreparation, waitForReaderPrebuildsForTests } = await import('./reader-content.service')
    sourceExists = false
    expect(enqueueReaderArchivePreparation({ ...book, size: sourceBuffer.length })).toBe('queued')
    await expect(waitForReaderPrebuildsForTests()).resolves.toBeUndefined()
  })

  it('rejects a deleted source even when its manifest and chapter caches are hot', async () => {
    const { getReaderManifest, readReaderEntry } = await import('./reader-content.service')
    await getReaderManifest(book)
    await readReaderEntry(book, 'OEBPS/text/ch1.xhtml')
    sourceExists = false
    await expect(getReaderManifest(book)).rejects.toMatchObject({ code: 'BOOK_FILE_MISSING' })
    await expect(readReaderEntry(book, 'OEBPS/text/ch1.xhtml')).rejects.toMatchObject({ code: 'BOOK_FILE_MISSING' })
  })

  it('evicts old derived disk files under the real 256 MiB budget', async () => {
    const { getReaderManifest } = await import('./reader-content.service')
    const dir = path.join(testDataDir, 'reader-content-index', 'v3')
    await fs.mkdir(dir, { recursive: true })
    for (const [index, name] of ['old-a.json', 'old-b.json', 'recent.json'].entries()) {
      const file = path.join(dir, name)
      const handle = await fs.open(file, 'w')
      await handle.truncate(96 * 1024 * 1024)
      await handle.close()
      await fs.utimes(file, new Date(1000 + index * 1000), new Date(1000 + index * 1000))
    }
    await getReaderManifest(book)
    await waitForReaderDerivedWritesForTests()
    const files = await fs.readdir(dir)
    const sizes = await Promise.all(files.map(async name => (await fs.stat(path.join(dir, name))).size))
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(256 * 1024 * 1024)
    expect(files).not.toContain('old-a.json')
    expect(files).toContain('recent.json')
    resetReaderContentCachesForTests()
    expect((await getReaderManifest(book)).spine).toHaveLength(2)
  })

  it('bounds prepared sources to 24 entries and rebuilds evicted sources', async () => {
    const { getReaderManifest } = await import('./reader-content.service')
    const books = Array.from({ length: 26 }, (_, index) => ({ ...book, contentHash: `pressure-${index}` }))
    for (const source of books) await getReaderManifest(source)
    await waitForReaderDerivedWritesForTests()
    await fs.rm(path.join(testDataDir, 'reader-content-index'), { recursive: true, force: true })
    sourceReadCount = 0
    await getReaderManifest(books[25]!)
    expect(sourceReadCount).toBe(0)
    await getReaderManifest(books[0]!)
    expect(sourceReadCount).toBeGreaterThan(0)
  })

  it('bounds the raw hot cache to 128 MiB and retains recent entries', async () => {
    const { readReaderEntry } = await import('./reader-content.service')
    const zip = await JSZip.loadAsync(sourceBuffer)
    zip.file('OEBPS/payload.bin', Buffer.alloc(8 * 1024 * 1024, 31), { compression: 'STORE' })
    sourceBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    const books = Array.from({ length: 18 }, (_, index) => ({ ...book, contentHash: `raw-pressure-${index}` }))
    for (const source of books) await readReaderEntry(source, 'OEBPS/payload.bin')
    sourceReadCount = 0
    expect((await readReaderEntry(books[17]!, 'OEBPS/payload.bin'))?.data.length).toBe(8 * 1024 * 1024)
    expect(sourceReadCount).toBe(0)
    await readReaderEntry(books[0]!, 'OEBPS/payload.bin')
    expect(sourceReadCount).toBeGreaterThan(0)
  }, 30000)

  it('prebuilds EPUB structure without reading chapter bodies or media', async () => {
    const { enqueueReaderArchivePreparation, waitForReaderPrebuildsForTests } = await import('./reader-content.service')
    const finalTxtArtifact = { ...book, format: 'txt', size: sourceBuffer.length }
    expect(enqueueReaderArchivePreparation(finalTxtArtifact)).toBe('queued')
    await waitForReaderPrebuildsForTests()
    expect(sourceReadRanges.every((range) => range !== undefined)).toBe(true)
    const readsAfterStructure = sourceReadCount
    const { readReaderEntry } = await import('./reader-content.service')
    await readReaderEntry(finalTxtArtifact, 'OEBPS/text/ch1.xhtml')
    expect(sourceReadCount).toBeGreaterThan(readsAfterStructure)
    const readsAfterText = sourceReadCount
    await readReaderEntry(finalTxtArtifact, 'OEBPS/images/cover.png')
    expect(sourceReadCount).toBeGreaterThan(readsAfterText)
  })

  it('keeps queued source snapshots across later object mutation and content revisions', async () => {
    const { enqueueReaderArchivePreparation, waitForReaderPrebuildsForTests } = await import('./reader-content.service')
    const firstRevision = { ...book, size: sourceBuffer.length }
    expect(enqueueReaderArchivePreparation(firstRevision)).toBe('queued')
    firstRevision.filePath = 'content/mutated.epub'
    firstRevision.contentHash = 'mutated-hash'
    firstRevision.revisionId = 'mutated-revision'
    const nextRevision = {
      ...book,
      id: 'book-2',
      filePath: 'content/book-2.epub',
      contentHash: 'hash-2',
      revisionId: 'rev-2',
      size: sourceBuffer.length,
    }
    expect(enqueueReaderArchivePreparation(nextRevision)).toBe('queued')
    await waitForReaderPrebuildsForTests()
    expect(sourceRequestedKeys).toContain('content/book-1.epub')
    expect(sourceRequestedKeys).toContain('content/book-2.epub')
    expect(sourceRequestedKeys).not.toContain('content/mutated.epub')
  })
})
