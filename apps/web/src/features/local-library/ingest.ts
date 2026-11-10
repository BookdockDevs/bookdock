import { normalizeBookTitle, type ClientBook, type ClientCatalogAttributes } from '@bookdock/shared'
import { loadFoliateEngine } from '../reader/content/load-engine'
import { localEpubProvider } from '../reader/content/local-epub-provider'
import { localRecordId } from './id'
import { publicationBookMetadata, publicationMetadata } from './publication-metadata'
import { prepareTxtInWorker } from './prepare-txt-worker'
import { localLibraryRepository } from './repository'
import type { LocalLibraryRepository } from './repository'

export async function addLocalEpub(file: File, vaultId: string, identity?: { bookId: string; contentId: string; createdAt: number; signal?: AbortSignal; catalog?: ClientCatalogAttributes; normalizeTitle?: boolean }, repository: LocalLibraryRepository = localLibraryRepository): Promise<ClientBook> {
  if (!file.name.toLowerCase().endsWith('.epub') || file.size === 0) throw new Error('Select a non-empty EPUB file')
  const bookId = identity?.bookId ?? localRecordId()
  const contentId = identity?.contentId ?? localRecordId()
  const signal = identity?.signal ?? new AbortController().signal
  signal.throwIfAborted()
  const lease = await localEpubProvider(contentId, file).open(await loadFoliateEngine(), signal)
  try {
    const metadata = lease.book.metadata ?? {}
    const source = publicationMetadata(metadata, file.name, identity?.normalizeTitle !== false)
    const now = identity?.createdAt ?? Date.now()
    const ref = { scope: { kind: 'local' as const, vaultId }, bookId }
    const book: ClientBook = { ref, title: source.values.title ?? file.name.replace(/\.epub$/i, ''), authors: source.values.authors ?? [],
      format: 'epub', content: { book: ref, contentId }, availability: 'available', size: file.size, createdAt: now, updatedAt: now, version: 0,
      catalog: { ...identity?.catalog, metadata: publicationBookMetadata(metadata, source) } }
    const cover = await lease.book.getCover?.().catch(() => null)
    let thumbnail: Blob | undefined
    if (cover) {
      try {
        const image = await createImageBitmap(cover)
        try {
          const canvas = document.createElement('canvas')
          const scale = Math.min(1, 360 / Math.max(image.width, image.height))
          canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
          canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
          thumbnail = await new Promise<Blob | undefined>((resolve) => canvas.toBlob((value) => resolve(value ?? undefined), 'image/png'))
        } finally { image.close() }
      } catch { /* Invalid or unsupported covers use the shared placeholder. */ }
    }
    signal.throwIfAborted()
    return await repository.addBook(book, file, thumbnail, undefined, signal)
  } finally { lease.release() }
}

export async function addLocalBook(file: File, vaultId: string, identity?: Parameters<typeof addLocalEpub>[2], repository: LocalLibraryRepository = localLibraryRepository): Promise<ClientBook> {
  if (file.name.toLowerCase().endsWith('.epub')) return addLocalEpub(file, vaultId, identity, repository)
  if (!file.name.toLowerCase().endsWith('.txt')) throw new Error('Select an EPUB or TXT file')
  const bookId = identity?.bookId ?? localRecordId()
  const contentId = identity?.contentId ?? localRecordId()
  const derived = identity?.normalizeTitle !== false ? normalizeBookTitle(file.name) : undefined
  const title = derived?.title || file.name.replace(/\.txt$/i, '') || file.name
  const authors = derived?.authors && derived.authors.length > 0
    ? derived.authors
    : derived?.author
      ? [derived.author]
      : []
  const signal = identity?.signal ?? new AbortController().signal
  const prepared = await prepareTxtInWorker(file, title, contentId, signal)
  signal.throwIfAborted()
  const now = identity?.createdAt ?? Date.now()
  const ref = { scope: { kind: 'local' as const, vaultId }, bookId }
  const book: ClientBook = { ref, title, authors, format: 'txt', content: { book: ref, contentId }, textSource: prepared.source,
    availability: 'available', size: file.size, createdAt: now, updatedAt: now, version: 0, ...(identity?.catalog ? { catalog: identity.catalog } : {}) }
  return repository.addBook(book, file, undefined, prepared, signal)
}
