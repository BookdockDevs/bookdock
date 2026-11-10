import { BlobReader, BlobWriter, TextWriter, ZipReader, configure } from '@zip.js/zip.js'

import { editorEpubSaveSchema, patchEpubPackage, readEpubEditorPackage } from '@bookdock/shared'
import type { EditorEpubSaveReq } from '@bookdock/shared'

export async function openEditorArchive(file: Blob, signal: AbortSignal) {
  signal.throwIfAborted()
  configure({ useWebWorkers: false })
  const zip = new ZipReader(new BlobReader(file))
  try {
    const entries = (await zip.getEntries()).filter((entry) => !entry.directory)
    const paths = new Set<string>()
    let total = 0
    for (const entry of entries) {
      const path = entry.filename
      if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.') || paths.has(path)) throw new Error('Unsafe or ambiguous EPUB resource path')
      paths.add(path)
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > 64 * 1024 * 1024) throw new Error('EPUB resource exceeds the extraction limit')
      total += entry.uncompressedSize
      if (total > 512 * 1024 * 1024 || entries.length > 10_000) throw new Error('EPUB exceeds the extraction limit')
    }
    signal.throwIfAborted()
    return { entries, release: () => zip.close() }
  } catch (error) { await zip.close(); throw error }
}

export async function readEditorResource(file: Blob, path: string, type: string | undefined, signal: AbortSignal): Promise<string | Blob | null> {
  const archive = await openEditorArchive(file, signal)
  try {
    const entry = archive.entries.find((entry) => entry.filename === path)
    if (!entry || !entry.getData) return null
    const options = { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), checkSignature: true }
    return type === undefined ? await entry.getData(new TextWriter(), options) : await entry.getData(new BlobWriter(type), options)
  } finally { await archive.release() }
}

export async function processLocalEpub(file: Blob, signal: AbortSignal, input?: EditorEpubSaveReq) {
  const archive = await openEditorArchive(file, signal)
  await archive.release()
  const bytes = new Uint8Array(await file.arrayBuffer())
  signal.throwIfAborted()
  const source = await readEpubEditorPackage(bytes)
  if (!input) return { source }
  const draft = editorEpubSaveSchema.parse(input)
  const unchanged = draft.documents.every((patch) => source.documents.some((original) => original.href === patch.href && original.content === patch.content))
    && JSON.stringify(source.tocEntries) === JSON.stringify(draft.tocEntries)
    && JSON.stringify(source.spineOrder) === JSON.stringify(draft.spineOrder)
  if (unchanged) return { source }
  const updated = await patchEpubPackage(bytes, draft)
  signal.throwIfAborted()
  return { source, file: new Blob([updated as Uint8Array<ArrayBuffer>], { type: 'application/epub+zip' }) }
}

export async function describeEditorEpub(file: Blob, signal: AbortSignal) {
  const archive = await openEditorArchive(file, signal)
  try {
    const entries = archive.entries.map((entry) => ({ path: entry.filename, size: entry.uncompressedSize, mediaType: mediaType(entry.filename) }))
    return entries
  } finally { await archive.release() }
}

function mediaType(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  return ({ xhtml: 'application/xhtml+xml', html: 'text/html', xml: 'application/xml', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' } as Record<string, string>)[extension] ?? 'application/octet-stream'
}
