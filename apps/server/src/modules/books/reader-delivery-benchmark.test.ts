import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'

import { Hono } from 'hono'
import { compress } from 'hono/compress'
import JSZip from 'jszip'
import { afterAll, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  dir: `${process.cwd()}/.tmp-reader-benchmark-${process.pid}-${Date.now()}`,
  bytes: Buffer.alloc(0),
  book: { id: 'benchmark', filePath: 'fixture.epub', revisionId: 'r1', contentHash: '', format: 'epub', size: 0 },
  sourceReads: 0,
  sourceBytes: 0,
}))
vi.mock('../../config', () => ({ config: { dataDir: state.dir } }))
vi.mock('./books.service', () => ({ getActiveBook: async () => state.book }))
vi.mock('../../storage', () => ({ getStorage: () => ({
  exists: async () => true,
  size: async () => state.bytes.length,
  get: async (_key: string, range?: { start: number; end: number }) => {
    const data = range ? state.bytes.subarray(range.start, range.end + 1) : state.bytes
    state.sourceReads++
    state.sourceBytes += data.length
    return Readable.from([data])
  },
}) }))

import readerRoutes from './reader-content.routes'
import { getReaderManifest, readReaderEntry, resetReaderContentCachesForTests, waitForReaderDerivedWritesForTests } from './reader-content.service'

afterAll(async () => {
  await waitForReaderDerivedWritesForTests()
  await fs.rm(state.dir, { recursive: true, force: true })
})

it.runIf(process.env.READER_BENCHMARK === '1')('compares reproducible cold/warm delivery over the same shaped HTTP link', async () => {
  const webRequire = createRequire(path.resolve('../web/package.json'))
  const { ZipReader, HttpReader, Uint8ArrayReader, Uint8ArrayWriter, configure } = await import(
    /* @vite-ignore */ pathToFileURL(webRequire.resolve('@zip.js/zip.js')).href
  )
  configure({ useWebWorkers: false })
  const app = new Hono()
  app.use('*', compress())
  app.use('*', async (c, next) => {
    c.set('user', { id: 'fixture-user', username: 'fixture-user', role: 'user', avatarKey: null })
    await next()
  })
  app.route('/api/v1/books', readerRoutes)
  let requests = 0
  let transferred = 0
  // Control latency and throughput equally for both actual HTTP transports.
  const latencyMs = 80
  const bytesPerSecond = 4 * 1024 * 1024
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const server = createServer(async (req, res) => {
    requests++
    let data: Buffer
    if (req.url === '/file') {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
      const start = match ? Number(match[1]) : 0
      const end = match ? Math.min(Number(match[2] || state.bytes.length - 1), state.bytes.length - 1) : state.bytes.length - 1
      data = state.bytes.subarray(start, end + 1)
      res.statusCode = match ? 206 : 200
      res.setHeader('accept-ranges', 'bytes')
      if (match) res.setHeader('content-range', `bytes ${start}-${end}/${state.bytes.length}`)
      res.setHeader('content-length', data.length)
    } else {
      const response = await app.request(`http://fixture${req.url}`, {
        headers: { 'accept-encoding': req.headers['accept-encoding'] ?? '' },
      })
      res.statusCode = response.status
      response.headers.forEach((value, key) => res.setHeader(key, value))
      data = Buffer.from(await response.arrayBuffer())
      res.setHeader('content-length', data.length)
    }
    await pause(latencyMs)
    if (req.method === 'HEAD') { res.end(); return }
    for (let offset = 0; offset < data.length; offset += 65536) {
      const chunk = data.subarray(offset, offset + 65536)
      await pause(chunk.length / bytesPerSecond * 1000)
      transferred += chunk.length
      res.write(chunk)
    }
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const origin = `http://127.0.0.1:${address.port}`
  const results: Record<string, unknown>[] = []
  try {
    for (const [sample, mediaBytes] of [['text-only', 0], ['small-media', 2 * 1048576], ['large-media', 8 * 1048576]] as const) {
      const zip = new JSZip()
      zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
      const chapters = Array.from({ length: 64 }, (_, index) => `ch${index}.xhtml`)
      zip.file('OEBPS/content.opf', `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((href, i) => `<item id="c${i}" href="${href}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`)
      zip.file('OEBPS/nav.xhtml', '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="ch30.xhtml">Target</a></li></ol></nav></body></html>')
      for (const [i, href] of chapters.entries()) zip.file(`OEBPS/${href}`, `<html><body><h1>${i}</h1><p>${'生成的正文样本。'.repeat(1024)}</p></body></html>`)
      if (mediaBytes) zip.file('OEBPS/media.bin', Buffer.alloc(mediaBytes, 37), { compression: 'STORE' })
      state.bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
      state.book = { ...state.book, contentHash: createHash('sha256').update(state.bytes).digest('hex'), size: state.bytes.length }
      const target = 'OEBPS/ch30.xhtml'
      const expected = await zip.file(target)!.async('string')
      for (const warmth of ['cold-server', 'warm-server']) {
        for (let round = 0; round < 3; round++) {
          for (const mode of round % 2 ? ['new', 'old'] : ['old', 'new']) {
            await waitForReaderDerivedWritesForTests()
            resetReaderContentCachesForTests()
            await fs.rm(path.join(state.dir, 'reader-content-index'), { recursive: true, force: true })
            if (warmth === 'warm-server') {
              await getReaderManifest(state.book)
              await readReaderEntry(state.book, target)
            }
            requests = transferred = state.sourceReads = state.sourceBytes = 0
            const start = performance.now()
            let text: string
            if (mode === 'old') {
              const reader = state.bytes.length <= 4 * 1048576
                ? new Uint8ArrayReader(new Uint8Array(await (await fetch(`${origin}/file`)).arrayBuffer()))
                : new HttpReader(`${origin}/file`, { useRangeHeader: true })
              const archive = new ZipReader(reader)
              try {
                const entries = await archive.getEntries()
                for (const file of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml']) {
                  await entries.find((entry: { filename: string }) => entry.filename === file).getData(new Uint8ArrayWriter())
                }
                text = new TextDecoder().decode(await entries.find((entry: { filename: string }) => entry.filename === target).getData(new Uint8ArrayWriter()))
              } finally { await archive.close() }
            } else {
              const manifest = await (await fetch(`${origin}/api/v1/books/benchmark/reader/manifest`)).json()
              expect(manifest.data.spine).toHaveLength(64)
              const entry = await (await fetch(`${origin}/api/v1/books/benchmark/reader/entry?revisionId=r1&path=${target}`)).json()
              text = entry.data.text
            }
            expect(text).toBe(expected)
            results.push({ sample, archiveBytes: state.bytes.length, warmth, round, mode,
              ms: Math.round(performance.now() - start), requests, transferred,
              sourceReads: state.sourceReads, sourceBytes: state.sourceBytes })
          }
        }
      }
    }
    console.log('READER_DELIVERY_BENCHMARK', JSON.stringify({ latencyMs, bytesPerSecond, results }))
    if (process.env.READER_BENCHMARK_OUTPUT) {
      await fs.writeFile(process.env.READER_BENCHMARK_OUTPUT, JSON.stringify({ latencyMs, bytesPerSecond, results }, null, 2))
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}, 120000)
