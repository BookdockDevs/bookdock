import type { ReaderBookProvider } from './book-provider'
import { securePublicationMarkup } from './secure-publication-markup'

const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 512 * 1024 * 1024

export function localEpubProvider(cacheIdentity: string, blob: Blob): ReaderBookProvider {
  return {
    cacheIdentity,
    async open(foliate, signal) {
      signal.throwIfAborted()
      foliate.configure?.({ useWebWorkers: false })
      const zip = new foliate.ZipReader(new foliate.BlobReader(blob))
      let released = false
      let book: any
      const release = () => {
        if (released) return
        released = true
        book?.destroy?.()
        void Promise.resolve(zip.close()).catch(() => {})
      }
      try {
        const entries = await zip.getEntries()
        signal.throwIfAborted()
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
          signal.throwIfAborted()
          if (released) throw new Error('EPUB content session is closed')
          const entry = map.get(name)
          if (!entry) return null
          const result = await entry.getData(writer, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), checkSignature: true })
          signal.throwIfAborted()
          return result
        }
        book = await new foliate.EPUB({
          entries: [...map.values()],
          loadText: (name: string) => read(name, new foliate.TextWriter()),
          loadBlob: (name: string, type?: string) => read(name, new foliate.BlobWriter(type)),
          getSize: (name: string) => map.get(name)?.uncompressedSize ?? 0,
        }).init()
        signal.throwIfAborted()
        book.transformTarget?.addEventListener('data', (event: Event) => {
          const detail = (event as CustomEvent).detail
          if (!['application/xhtml+xml', 'text/html', 'image/svg+xml'].includes(detail.type)) return
          detail.data = Promise.resolve(detail.data).then((source) => typeof source === 'string' ? securePublicationMarkup(source, detail.type) : source)
        })
        book.publicationMarkupSecured = true
        book.contentSource = 'local'
        return { book, release }
      } catch (error) {
        release()
        throw error
      }
    },
  }
}
