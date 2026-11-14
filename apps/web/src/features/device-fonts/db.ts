import { localRecordId } from '@/features/local-library/id'

const DB_NAME = 'bookdock-device-fonts'
const DB_VERSION = 1
const STORES = ['meta', 'blobs'] as const

/** Matches the server's FONT_UPLOAD_MAX_BYTES default (100 MB) so a font
 *  accepted locally would also be accepted by a later server upload. */
export const DEVICE_FONT_MAX_BYTES = 100 * 1024 * 1024

export type DeviceFontFormat = 'ttf' | 'otf' | 'woff' | 'woff2'

export interface DeviceFontMeta {
  /** `device-` prefixed, so it can never collide with a server font nanoid */
  id: string
  /** Cross-language sfnt family (TTF/OTF/WOFF1), the file base name otherwise */
  family: string
  /** Windows LANGID (hex key, e.g. `804` = zh-CN) → localized display name;
   *  full name (nameID 4) preferred over typographic family (16) then family */
  localNames?: Record<string, string> | null
  fileName: string
  format: DeviceFontFormat
  size: number
  /** SHA-256 of the file bytes; re-imports of the same file dedupe onto this */
  contentHash: string
  createdAt: number
}

export type DeviceFontErrorCategory = 'empty' | 'too-large' | 'invalid' | 'storage-full' | 'storage-unavailable'

export class DeviceFontError extends Error {
  constructor(public readonly category: DeviceFontErrorCategory, message: string) {
    super(message)
  }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
}

export class DeviceFontStore {
  private opening?: Promise<IDBDatabase>
  constructor(private databaseName = DB_NAME) {}

  private database(): Promise<IDBDatabase> {
    this.opening ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(this.databaseName, DB_VERSION)
      open.onupgradeneeded = () => {
        for (const store of STORES) if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store)
      }
      open.onsuccess = () => {
        open.result.onversionchange = () => { open.result.close(); this.opening = undefined }
        resolve(open.result)
      }
      open.onerror = () => { this.opening = undefined; reject(open.error) }
      open.onblocked = () => { this.opening = undefined; reject(new DeviceFontError('storage-unavailable', 'Close other tabs using device fonts')) }
    })
    return this.opening
  }

  private async transaction<T>(mode: IDBTransactionMode, operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    let db: IDBDatabase
    try {
      db = await this.database()
    } catch (error) {
      throw toDeviceFontError(error)
    }
    const tx = db.transaction([...STORES], mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('Device font storage transaction aborted'))
      tx.onerror = () => {}
    })
    void done.catch(() => {})
    try {
      const result = await operation(tx)
      await done
      return result
    } catch (error) {
      try { tx.abort() } catch { /* A completed transaction cannot be aborted. */ }
      await done.catch(() => {})
      throw toDeviceFontError(error)
    }
  }

  async list(): Promise<DeviceFontMeta[]> {
    return this.transaction('readonly', async (tx) => {
      const all = await request(tx.objectStore('meta').getAll() as IDBRequest<DeviceFontMeta[]>)
      return all.filter((meta) => meta && typeof meta.id === 'string').sort((a, b) => a.createdAt - b.createdAt)
    })
  }

  async getBlob(id: string): Promise<Blob | null> {
    return this.transaction('readonly', async (tx) => {
      const blob = await request(tx.objectStore('blobs').get(id) as IDBRequest<Blob | undefined>)
      // Duck-typed rather than instanceof: some structured-clone backends
      // rebuild Blob from their own class, and only the shape matters here
      return blob && typeof blob === 'object' && typeof blob.arrayBuffer === 'function' ? blob : null
    })
  }

  async delete(id: string): Promise<void> {
    await this.transaction('readwrite', async (tx) => {
      tx.objectStore('meta').delete(id)
      tx.objectStore('blobs').delete(id)
    })
  }

  /** Validate + store one font file. Dedupes on content hash like the server
   *  (unique per file, re-import returns the existing entry). */
  async import(file: File): Promise<{ font: DeviceFontMeta; duplicate: boolean }> {
    if (file.size === 0) throw new DeviceFontError('empty', 'The font file is empty')
    if (file.size > DEVICE_FONT_MAX_BYTES) throw new DeviceFontError('too-large', 'The font file exceeds the 100 MB limit')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const format = sniffFontFormat(bytes)
    if (!format) throw new DeviceFontError('invalid', 'Not a recognized font file')
    // Magic bytes alone accept truncated/corrupt files (e.g. a bare wOFF
    // header): the browser's real decoder is the authority when available.
    // jsdom has no FontFace and skips this check.
    if (typeof FontFace === 'function') {
      const face = new FontFace('bd-import-check', bytes)
      try {
        await face.load()
      } catch {
        throw new DeviceFontError('invalid', 'The font file cannot be decoded')
      }
    }
    const contentHash = await computeSha256(bytes)
    const existing = (await this.list()).find((meta) => meta.contentHash === contentHash)
    if (existing) return { font: existing, duplicate: true }
    // ttf/otf parse directly, woff1 inflates its name table, woff2 (Brotli)
    // is not parsed and falls back to the file name
    const names = await parseDeviceFontNames(bytes)
    const font: DeviceFontMeta = {
      id: `device-${localRecordId()}`,
      family: names.family ?? fileBaseName(file.name),
      localNames: names.localNames,
      fileName: file.name,
      format,
      size: file.size,
      contentHash,
      createdAt: Date.now(),
    }
    await this.transaction('readwrite', async (tx) => {
      tx.objectStore('meta').put(font, font.id)
      tx.objectStore('blobs').put(file, font.id)
    })
    return { font, duplicate: false }
  }
}

function toDeviceFontError(error: unknown): Error {
  if (error instanceof DeviceFontError) return error
  const name = (error as { name?: string } | null)?.name
  if (name === 'QuotaExceededError') return new DeviceFontError('storage-full', 'Device storage is full')
  const message = error instanceof Error ? error.message : String(error)
  return new DeviceFontError('storage-unavailable', `Device font storage is unavailable: ${message}`)
}

/** Language-tagged names extracted from a font file. `localNames` keys are
 *  Windows LANGID hex strings (e.g. `804` = zh-CN); each entry prefers the
 *  full name (nameID 4) over typographic family (16) then family (1). */
export interface DeviceFontNames {
  family: string | null
  localNames: Record<string, string> | null
}

const MAX_LOCAL_NAMES = 12
// Bounds the WOFF1 inflate against decompression bombs, mirroring the server
const MAX_NAME_TABLE_BYTES = 1024 * 1024

interface NameRecord {
  platform: number
  language: number
  nameId: number
  start: number
  length: number
}

function readNameTable(table: Uint8Array): NameRecord[] | null {
  try {
    if (table.length < 6) return null
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength)
    const count = view.getUint16(2)
    const stringBase = view.getUint16(4)
    const records: NameRecord[] = []
    for (let i = 0; i < count; i++) {
      const rec = 6 + i * 12
      if (rec + 12 > table.length) return null
      const start = stringBase + view.getUint16(rec + 10)
      const length = view.getUint16(rec + 8)
      if (start + length > table.length) continue
      records.push({ platform: view.getUint16(rec), language: view.getUint16(rec + 4), nameId: view.getUint16(rec + 6), start, length })
    }
    return records
  } catch {
    return null
  }
}

async function locateNameTable(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (bytes.length < 12) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const version = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
    if (version === 'wOF2') return null
    if (version === 'wOFF') {
      const numTables = view.getUint16(12)
      for (let i = 0; i < numTables; i++) {
        const rec = 44 + i * 20
        if (rec + 20 > bytes.length) return null
        if (String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!) !== 'name') continue
        const offset = view.getUint32(rec + 4)
        const compLength = view.getUint32(rec + 8)
        const origLength = view.getUint32(rec + 12)
        if (offset + compLength > bytes.length) return null
        if (origLength > MAX_NAME_TABLE_BYTES) return null
        const stored = bytes.subarray(offset, offset + compLength)
        // WOFF1 entries are zlib-compressed whenever stored < original
        const inflated = compLength < origLength ? await inflateZlib(stored) : stored
        return inflated && inflated.length <= MAX_NAME_TABLE_BYTES ? inflated : null
      }
      return null
    }
    const numTables = view.getUint16(4)
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16
      if (rec + 16 > bytes.length) return null
      if (String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!) === 'name') {
        const offset = view.getUint32(rec + 8)
        const length = view.getUint32(rec + 12)
        if (offset + length > bytes.length) return null
        return bytes.subarray(offset, offset + length)
      }
    }
    return null
  } catch {
    return null
  }
}

async function inflateZlib(stored: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (typeof DecompressionStream !== 'function') return null
    const body = new Blob([stored as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
    return new Uint8Array(await new Response(body).arrayBuffer())
  } catch {
    return null
  }
}

/** Browser-safe port of the server's `parseFontNames` (lib/font-name.ts).
 *  TTF/OTF parse directly, WOFF1 inflates its name table, WOFF2 (Brotli) is
 *  not parsed. Malformed input returns nulls and never throws. */
export async function parseDeviceFontNames(bytes: Uint8Array): Promise<DeviceFontNames> {
  const empty: DeviceFontNames = { family: null, localNames: null }
  try {
    const table = await locateNameTable(bytes)
    if (!table) return empty
    const records = readNameTable(table)
    if (!records) return empty

    const decode = (r: NameRecord): string => {
      const raw = table.subarray(r.start, r.start + r.length)
      if (r.platform === 1) return new TextDecoder('latin1').decode(raw)
      // Platforms 0 (Unicode) and 3 (Windows) store UTF-16BE
      const swapped = new Uint8Array(raw.length)
      for (let i = 0; i + 1 < raw.length; i += 2) {
        swapped[i] = raw[i + 1]!
        swapped[i + 1] = raw[i]!
      }
      return new TextDecoder('utf-16le').decode(swapped)
    }
    const decodeTrimmed = (r: NameRecord): string => decode(r).replaceAll('\0', '').trim()

    const localNames: Record<string, string> = {}
    const preferredNameIds = [4, 16, 1]
    const windowsRecords = records.filter((r) => r.platform === 3 && preferredNameIds.includes(r.nameId))
    const languages = [...new Set(windowsRecords.map((r) => r.language))].slice(0, MAX_LOCAL_NAMES)
    for (const language of languages) {
      for (const nameId of preferredNameIds) {
        const record = windowsRecords.find((c) => c.language === language && c.nameId === nameId)
        if (!record) continue
        const value = decodeTrimmed(record)
        if (!value) continue
        localNames[language.toString(16)] = value
        break
      }
    }

    let family: string | null = null
    for (const nameId of [16, 1]) {
      const candidates = records.filter((r) => r.nameId === nameId)
      const best =
        candidates.find((r) => r.platform === 3 && r.language === 0x409) ??
        candidates.find((r) => r.platform === 1 && r.language === 0) ??
        candidates.find((r) => r.platform === 3) ??
        candidates[0]
      if (!best) continue
      const candidate = decodeTrimmed(best)
      if (candidate) {
        family = candidate
        break
      }
    }
    return { family, localNames: Object.keys(localNames).length > 0 ? localNames : null }
  } catch {
    return empty
  }
}

/** Format from magic bytes only — the file extension is never trusted. */
export function sniffFontFormat(bytes: Uint8Array): DeviceFontFormat | null {
  if (bytes.length < 4) return null
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  if (magic === 'wOFF') return 'woff'
  if (magic === 'wOF2') return 'woff2'
  if (magic === 'OTTO') return 'otf'
  if (magic === 'true' || magic === 'ttcf') return 'ttf'
  if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) return 'ttf'
  return null
}

async function computeSha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fileBaseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  return base.trim() || fileName
}
