import { localRecordId } from '@/features/local-library/id'

const DB_NAME = 'bookdock-theme-assets'
const DB_VERSION = 1
const STORES = ['meta', 'blobs'] as const

export const THEME_ASSET_LIMITS = {
  /** Per-image byte cap */
  maxBytes: 20 * 1024 * 1024,
  /** Per-image width/height cap (either axis) */
  maxDimension: 8192,
  /** Per-theme manifest cap (editor UI + package import enforce this) */
  maxPerTheme: 32,
  /** Per-scope stored-asset count cap */
  maxPerScope: 512,
  /** Per-scope stored-bytes cap — the browser quota is the real ceiling */
  maxScopeBytes: 512 * 1024 * 1024,
} as const

export type ThemeAssetMime = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ThemeAssetMeta {
  /** `asset-` prefixed stable id; theme definitions reference this */
  id: string
  /** Account id, or 'device' for signed-out reading */
  scope: string
  fileName: string
  mime: ThemeAssetMime
  size: number
  width: number
  height: number
  /** SHA-256 of the file bytes; re-imports of the same file dedupe onto this */
  contentHash: string
  createdAt: number
}

export type ThemeAssetErrorCategory =
  | 'empty'
  | 'too-large'
  | 'too-large-dimensions'
  | 'invalid'
  | 'too-many'
  | 'storage-full'
  | 'storage-unavailable'

export class ThemeAssetError extends Error {
  constructor(public readonly category: ThemeAssetErrorCategory, message: string) {
    super(message)
  }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
}

export class ThemeAssetStore {
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
      open.onblocked = () => { this.opening = undefined; reject(new ThemeAssetError('storage-unavailable', 'Close other tabs using theme assets')) }
    })
    return this.opening
  }

  private async transaction<T>(mode: IDBTransactionMode, operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    let db: IDBDatabase
    try {
      db = await this.database()
    } catch (error) {
      throw toThemeAssetError(error)
    }
    const tx = db.transaction([...STORES], mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('Theme asset storage transaction aborted'))
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
      throw toThemeAssetError(error)
    }
  }

  async list(scope: string): Promise<ThemeAssetMeta[]> {
    return this.transaction('readonly', async (tx) => {
      const all = await request(tx.objectStore('meta').getAll() as IDBRequest<ThemeAssetMeta[]>)
      return all
        .filter((meta) => meta && typeof meta.id === 'string' && meta.scope === scope)
        .sort((a, b) => a.createdAt - b.createdAt)
    })
  }

  async getBlob(scope: string, id: string): Promise<Blob | null> {
    return this.transaction('readonly', async (tx) => {
      const meta = await request(tx.objectStore('meta').get(scopeKey(scope, id)) as IDBRequest<ThemeAssetMeta | undefined>)
      if (!meta || meta.scope !== scope) return null
      const blob = await request(tx.objectStore('blobs').get(scopeKey(scope, id)) as IDBRequest<Blob | undefined>)
      // Duck-typed rather than instanceof: some structured-clone backends
      // rebuild Blob from their own class, and only the shape matters here
      return blob && typeof blob === 'object' && typeof blob.arrayBuffer === 'function' ? blob : null
    })
  }

  async storePrepared(scope: string, entries: Array<{ key: string; image: PreparedThemeAsset; keepId?: boolean }>): Promise<Map<string, ThemeAssetMeta>> {
    if (!entries.length) return new Map()
    return this.transaction('readwrite', async (tx) => {
      const metaStore = tx.objectStore('meta')
      const blobStore = tx.objectStore('blobs')
      const all = await request(metaStore.getAll() as IDBRequest<ThemeAssetMeta[]>)
      const scopeAssets = all.filter((meta) => meta.scope === scope)
      const byId = new Map(scopeAssets.map((meta) => [meta.id, meta]))
      const byHash = new Map(scopeAssets.map((meta) => [meta.contentHash, meta]))
      let totalBytes = scopeAssets.reduce((total, meta) => total + meta.size, 0)
      const stored = new Map<string, ThemeAssetMeta>()
      for (const { key, image: { asset, blob }, keepId } of entries) {
        if (asset.scope !== scope) throw new ThemeAssetError('invalid', 'Image belongs to a different scope')
        const sameId = byId.get(asset.id)
        if (sameId && sameId.contentHash !== asset.contentHash) throw new ThemeAssetError('invalid', 'Image ID is already in use')
        const existing = sameId ?? (keepId ? undefined : byHash.get(asset.contentHash))
        if (existing) {
          stored.set(key, existing)
          continue
        }
        if (byId.size >= THEME_ASSET_LIMITS.maxPerScope || totalBytes + asset.size > THEME_ASSET_LIMITS.maxScopeBytes) {
          throw new ThemeAssetError('too-many', 'Too much stored theme image data')
        }
        metaStore.put(asset, scopeKey(scope, asset.id))
        blobStore.put(blob, scopeKey(scope, asset.id))
        byId.set(asset.id, asset)
        byHash.set(asset.contentHash, asset)
        totalBytes += asset.size
        stored.set(key, asset)
      }
      return stored
    })
  }
}

export interface PreparedThemeAsset {
  asset: ThemeAssetMeta
  blob: Blob
}

export async function prepareThemeAsset(scope: string, file: Blob, name?: string): Promise<PreparedThemeAsset> {
  if (file.size === 0) throw new ThemeAssetError('empty', 'The image file is empty')
  if (file.size > THEME_ASSET_LIMITS.maxBytes) throw new ThemeAssetError('too-large', 'The image file exceeds the 10 MB limit')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniffImageMime(bytes)
  if (!mime) throw new ThemeAssetError('invalid', 'Not a supported image (PNG, JPEG or WebP)')
  const dimensions = await readImageDimensions(bytes, mime)
  if (!dimensions) throw new ThemeAssetError('invalid', 'The image cannot be decoded')
  if (dimensions.width > THEME_ASSET_LIMITS.maxDimension || dimensions.height > THEME_ASSET_LIMITS.maxDimension) {
    throw new ThemeAssetError('too-large-dimensions', 'The image exceeds the 8192px dimension limit')
  }
  const contentHash = await computeSha256(bytes)
  const asset: ThemeAssetMeta = {
    id: `asset-${localRecordId()}`,
    scope,
    fileName: name ?? ('name' in file && typeof file.name === 'string' ? file.name : 'image'),
    mime,
    size: file.size,
    width: dimensions.width,
    height: dimensions.height,
    contentHash,
    createdAt: Date.now(),
  }
  return { asset, blob: file.type === mime ? file : file.slice(0, file.size, mime) }
}

function toThemeAssetError(error: unknown): Error {
  if (error instanceof ThemeAssetError) return error
  const name = (error as { name?: string } | null)?.name
  if (name === 'QuotaExceededError') return new ThemeAssetError('storage-full', 'Device storage is full')
  const message = error instanceof Error ? error.message : String(error)
  return new ThemeAssetError('storage-unavailable', `Theme asset storage is unavailable: ${message}`)
}

function scopeKey(scope: string, id: string): string {
  return `${scope}\u0000${id}`
}

/** Mime from magic bytes only — the file extension is never trusted. */
export function sniffImageMime(bytes: Uint8Array): ThemeAssetMime | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

interface ImageDimensions {
  width: number
  height: number
}

/** Real decode through the browser's image decoder when available (jsdom has
 *  no createImageBitmap and skips this check); falls back to parsing the
 *  header dimensions for PNG/JPEG/WebP so capped sizes are still enforced. */
export async function readImageDimensions(bytes: Uint8Array, mime: ThemeAssetMime): Promise<ImageDimensions | null> {
  const header = headerDimensions(bytes, mime)
  if (!header || header.width <= 0 || header.height <= 0) return null
  if (header.width > THEME_ASSET_LIMITS.maxDimension || header.height > THEME_ASSET_LIMITS.maxDimension) return header
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }))
      const dimensions = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      if (dimensions.width > 0 && dimensions.height > 0) return dimensions
      return null
    } catch {
      return null
    }
  }
  return header
}

function headerDimensions(bytes: Uint8Array, mime: ThemeAssetMime): ImageDimensions | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (mime === 'image/png') {
      // IHDR starts at byte 16 (8 signature + 4 length + 4 type)
      if (bytes.length < 24) return null
      return { width: view.getUint32(16), height: view.getUint32(20) }
    }
    if (mime === 'image/jpeg') {
      // Walk the segment chain to the SOF marker
      let pos = 2
      while (pos + 9 < bytes.length) {
        if (bytes[pos] !== 0xff) return null
        const marker = bytes[pos + 1]!
        const length = view.getUint16(pos + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: view.getUint16(pos + 5), width: view.getUint16(pos + 7) }
        }
        pos += 2 + length
      }
      return null
    }
    // WebP: VP8 (lossy), VP8L (lossless) or VP8X (extended) chunks
    const fourcc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)
    if (fourcc === 'VP8 ' && bytes.length >= 30) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
    if (fourcc === 'VP8L' && bytes.length >= 25) {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (fourcc === 'VP8X' && bytes.length >= 30) {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16))
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16))
      return { width, height }
    }
    return null
  } catch {
    return null
  }
}

async function computeSha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
