import { createRequire } from 'node:module'
import { statSync } from 'node:fs'
import { parentPort } from 'node:worker_threads'

import { decodeHTML } from 'entities'

const require = createRequire(import.meta.url)
const zlib = require('node:zlib') as typeof import('node:zlib')
const inflate = zlib.inflateSync
zlib.inflateSync = (data, options) => inflate(data, { ...options, maxOutputLength: 32 * 1024 * 1024 })
interface Keyword { keyText: string; recordStartOffset: number; recordEndOffset: number }
interface Parser {
  _keyBlockStartOffset: number
  _keyBlockInfoEndOffset: number
  keyInfoList: Array<{ firstKey: string; lastKey: string; keyBlockUnpackSize: number }>
  recordInfoList: Array<{ unpackAccumulatorOffset: number; unpackSize: number }>
  meta: { ext: string; decoder: TextDecoder }
  scanner: { filepath: string; readBuffer: (offset: number, length: number) => Uint8Array }
  readDict(): void
  strip: (word: string) => string
  lookupPartialKeyBlockListByKeyInfoId: (index: number) => Keyword[]
  lookupRecordByKeyBlock: (item: Keyword) => Uint8Array
}
const { Mdict } = require('js-mdict') as { Mdict: new (path: string) => Parser }

// The pinned upstream eagerly sorts every word. Keep its format/decompression
// implementation, but load only matching key blocks for multi-million-entry MDX.
class LazyDictionary extends Mdict {
  private blocks = new Map<number, Keyword[]>()
  private styles: Map<string, [string, string]> | undefined
  formatDefinition(definition: string) {
    if (!this.styles) {
      this.styles = new Map()
      // Upstream collapses blank stylesheet lines, losing empty closing tags.
      const size = Buffer.from(this.scanner.readBuffer(0, 4)).readUInt32BE()
      const header = new TextDecoder('utf-16le').decode(this.scanner.readBuffer(4, size))
      const value = header.match(/\bStyleSheet="([^"]*)"/)?.[1] ?? ''
      const lines = decodeHTML(value).replace(/\r\n?/g, '\n').split('\n')
      for (let index = 0; index + 2 < lines.length; index += 3) {
        const id = lines[index]!.trim()
        if (/^\d+$/.test(id)) this.styles.set(id, [lines[index + 1]!, lines[index + 2]!])
      }
    }
    return definition.replace(/`(\d+)`([\s\S]*?)(?=`\d+`|$)/g, (original, id: string, content: string) => {
      const style = this.styles!.get(id)
      return style ? style[0] + content + style[1] : original
    })
  }
  readDict() {
    const size = statSync(this.scanner.filepath).size
    const read = this.scanner.readBuffer.bind(this.scanner)
    this.scanner.readBuffer = (offset, length) => {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > 32 * 1024 * 1024 || offset + length > size) throw new Error('Invalid dictionary block')
      return read(offset, length)
    }
    super.readDict()
    if (this.keyInfoList.some((item) => item.keyBlockUnpackSize > 32 * 1024 * 1024) || this.recordInfoList.some((item) => item.unpackSize > 32 * 1024 * 1024)) throw new Error('Dictionary block exceeds budget')
  }
  _readKeyBlocks() { this._keyBlockStartOffset = this._keyBlockInfoEndOffset }
  block(index: number) {
    let entries = this.blocks.get(index)
    if (!entries) {
      entries = this.lookupPartialKeyBlockListByKeyInfoId(index)
      if (this.blocks.size >= 16) this.blocks.delete(this.blocks.keys().next().value!)
      this.blocks.set(index, entries)
    }
    return entries
  }
  find(word: string) {
    const normalized = this.strip(word)
    const folded = word.toLowerCase()
    let match: { item: Keyword; index: number; score: number } | undefined
    blocks: for (let index = 0; index < this.keyInfoList.length; index++) {
      const info = this.keyInfoList[index]!
      const firstKey = info.firstKey.replaceAll('\0', ''), lastKey = info.lastKey.replaceAll('\0', '')
      const first = this.strip(firstKey), last = this.strip(lastKey)
      if (!(normalized >= first && normalized <= last) && !(folded >= firstKey.toLowerCase() && folded <= lastKey.toLowerCase()) && normalized !== first && normalized !== last) continue
      for (const item of this.block(index)) {
        const score = item.keyText === word ? 0 : item.keyText.toLowerCase() === folded ? 1 : this.strip(item.keyText) === normalized ? 2 : 3
        if (score < (match?.score ?? 3)) match = { item, index, score }
        if (score === 0) break blocks
      }
    }
    if (!match) return null
    const { item, index } = match
    if (item.recordEndOffset < 0) {
      const tail = this.recordInfoList[this.recordInfoList.length - 1]!
      item.recordEndOffset = index + 1 < this.keyInfoList.length ? this.block(index + 1)[0]!.recordStartOffset : tail.unpackAccumulatorOffset + tail.unpackSize
    }
    return { keyText: item.keyText, bytes: this.lookupRecordByKeyBlock(item) }
  }
}
let currentPath = ''
let dictionary: LazyDictionary | null = null
let resources: LazyDictionary[] = []

parentPort!.on('message', (job: { mdx: string; mdds: string[]; kind: 'validate' | 'lookup' | 'resource'; candidates?: string[]; key?: string }) => {
  try {
    if (currentPath !== job.mdx) {
      dictionary = new LazyDictionary(job.mdx)
      resources = job.mdds.map((file) => new LazyDictionary(file))
      currentPath = job.mdx
    }
    if (job.kind === 'validate') { parentPort!.postMessage({ ok: true }); return }
    if (job.kind === 'resource') {
      const key = job.key!.replaceAll('/', '\\').replace(/^\\+/, '')
      for (const archive of resources) {
        for (const candidate of [`\\${key}`, key]) {
          const result = archive.find(candidate)
          if (result) {
            if (result.bytes.length > 16 * 1024 * 1024) throw new Error('Resource is too large')
            parentPort!.postMessage({ data: Buffer.from(result.bytes).toString('base64') }); return
          }
        }
      }
      parentPort!.postMessage({ data: null }); return
    }
    for (const candidate of job.candidates ?? []) {
      let word = candidate
      const visited = new Set<string>()
      for (let hop = 0; hop < 6 && !visited.has(word); hop++) {
        visited.add(word)
        const result = dictionary!.find(word)
        if (!result) break
        if (result.bytes.length > 2 * 1024 * 1024) throw new Error('Definition is too large')
        const definition = dictionary!.meta.decoder.decode(result.bytes).replaceAll('\0', '')
        if (definition.trim().startsWith('@@@LINK=')) { word = definition.trim().slice(8).trim(); continue }
        parentPort!.postMessage({ headword: result.keyText, html: dictionary!.formatDefinition(definition) }); return
      }
    }
    parentPort!.postMessage({ headword: null, html: '' })
  } catch {
    parentPort!.postMessage({ error: true })
  }
})
