import type { ReaderBookLease, ReaderBookProvider } from './book-provider'
import { securePublicationMarkup } from './secure-publication-markup'

const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_LOCAL_EPUB_CACHE = 4

interface LocalEpubProviderOptions {
  cache?: boolean
}

interface CachedEpubEntry {
  promise: Promise<{ book: any; releaseArchive: () => void }>
  activeLeases: number
  evicted: boolean
  dispose?: () => void
}

const localEpubCache = new Map<string, CachedEpubEntry>()

function evictCachedEntry(cacheIdentity: string): void {
  const entry = localEpubCache.get(cacheIdentity)
  if (!entry) return
  entry.evicted = true
  localEpubCache.delete(cacheIdentity)
  if (entry.activeLeases === 0) entry.dispose?.()
}

export function evictLocalEpubCacheByPrefix(prefix: string): void {
  for (const cacheIdentity of [...localEpubCache.keys()]) {
    if (cacheIdentity.startsWith(prefix)) evictCachedEntry(cacheIdentity)
  }
}

export function clearLocalEpubCache(): void {
  for (const cacheIdentity of [...localEpubCache.keys()]) {
    evictCachedEntry(cacheIdentity)
  }
}

async function openLocalEpubArchive(
  blob: Blob,
  foliate: any,
  isClosed: () => boolean,
  signal?: AbortSignal,
): Promise<{ book: any; releaseArchive: () => void }> {
  signal?.throwIfAborted()
  foliate.configure?.({ useWebWorkers: false })
  const zip = new foliate.ZipReader(new foliate.BlobReader(blob))
  let released = false
  let book: any
  const releaseArchive = () => {
    if (released) return
    released = true
    book?.destroy?.()
    void Promise.resolve(zip.close()).catch(() => {})
  }
  try {
    const entries = await zip.getEntries()
    signal?.throwIfAborted()
    const map = new Map<string, any>()
    let total = 0
    for (const entry of entries) {
      if (entry.directory) continue
      const path = entry.filename
      if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part: string) => part === '..') || map.has(path)) throw new Error('Unsafe or ambiguous EPUB resource path')
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > MAX_ENTRY_BYTES) throw new Error('EPUB resource exceeds the extraction limit')
      total += entry.uncompressedSize
      if (total > MAX_TOTAL_BYTES) throw new Error('EPUB exceeds the extraction limit')
      map.set(path, entry)
    }
    const read = async (name: string, writer: any) => {
      signal?.throwIfAborted()
      if (released || isClosed()) throw new Error('EPUB content session is closed')
      const entry = map.get(name)
      if (!entry) return null
      const readSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000)
      const result = await entry.getData(writer, { signal: readSignal, checkSignature: true })
      signal?.throwIfAborted()
      return result
    }
    book = await new foliate.EPUB({
      entries: [...map.values()],
      loadText: (name: string) => read(name, new foliate.TextWriter()),
      loadBlob: (name: string, type?: string) => read(name, new foliate.BlobWriter(type)),
      getSize: (name: string) => map.get(name)?.uncompressedSize ?? 0,
    }).init()
    signal?.throwIfAborted()
    book.transformTarget?.addEventListener('data', (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!['application/xhtml+xml', 'text/html', 'image/svg+xml'].includes(detail.type)) return
      detail.data = Promise.resolve(detail.data).then((source) => typeof source === 'string' ? securePublicationMarkup(source, detail.type) : source)
    })
    book.publicationMarkupSecured = true
    book.contentSource = 'local'
    return { book, releaseArchive }
  } catch (error) {
    releaseArchive()
    throw error
  }
}

export function localEpubProvider(cacheIdentity: string, blob: Blob, options?: LocalEpubProviderOptions): ReaderBookProvider {
  if (!options?.cache) {
    return {
      cacheIdentity,
      async open(foliate, signal): Promise<ReaderBookLease> {
        let closed = false
        const { book, releaseArchive } = await openLocalEpubArchive(blob, foliate, () => closed, signal)
        return {
          book,
          release() {
            closed = true
            releaseArchive()
          },
        }
      },
    }
  }

  return {
    cacheIdentity,
    async open(foliate, signal): Promise<ReaderBookLease> {
      signal.throwIfAborted()
      let entry = localEpubCache.get(cacheIdentity)
      if (entry) {
        localEpubCache.delete(cacheIdentity)
        localEpubCache.set(cacheIdentity, entry)
      } else {
        const created: CachedEpubEntry = {
          promise: null as unknown as Promise<{ book: any; releaseArchive: () => void }>,
          activeLeases: 0,
          evicted: false,
        }
        // Cached reader books outlive any single mount's startup AbortSignal so
        // reopening the same book can keep reading chapters from the archive.
        created.promise = openLocalEpubArchive(blob, foliate, () => created.evicted).then((opened) => {
          created.dispose = opened.releaseArchive
          if (created.evicted && created.activeLeases === 0) opened.releaseArchive()
          return opened
        }, (error) => {
          if (localEpubCache.get(cacheIdentity) === created) localEpubCache.delete(cacheIdentity)
          throw error
        })
        localEpubCache.set(cacheIdentity, created)
        while (localEpubCache.size > MAX_LOCAL_EPUB_CACHE) {
          const oldest = localEpubCache.keys().next().value
          if (oldest === undefined) break
          evictCachedEntry(oldest)
        }
        entry = created
      }

      const opened = await entry.promise
      signal.throwIfAborted()
      if (entry.evicted) return localEpubProvider(cacheIdentity, blob, options).open(foliate, signal)
      entry.activeLeases += 1
      let released = false
      return {
        book: opened.book,
        release() {
          if (released) return
          released = true
          entry.activeLeases = Math.max(0, entry.activeLeases - 1)
          if (entry.evicted && entry.activeLeases === 0) entry.dispose?.()
        },
      }
    },
  }
}
