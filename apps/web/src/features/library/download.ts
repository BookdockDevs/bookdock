import { ApiError, BASE_URL } from '@/api/client'
import { withReveal } from '@/lib/reveal-hidden'
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js'

export interface PreparedBookFile {
  blob: Blob
  filename: string
}

export interface BookDownloadRequest {
  id: string
  title: string
  sourceFormat: 'epub' | 'txt'
  format: 'epub' | 'txt'
  edited: boolean
}

export function safeDownloadFileName(value: string) {
  const sanitized = Array.from(value, (character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || /[\\/:*?"<>|]/.test(character) ? '_' : character
  }).join('')
  return sanitized.replace(/[. ]+$/g, '') || 'book'
}

async function fetchBookFile(book: BookDownloadRequest, signal?: AbortSignal): Promise<PreparedBookFile> {
  const rawEpub = book.format === 'epub' && book.sourceFormat === 'epub'
  const endpoint = rawEpub
    ? `${BASE_URL}/books/${book.id}/file`
    : `${BASE_URL}/books/${book.id}/export.${book.format}${book.edited ? '' : '?plain=1'}`
  const res = await fetch(withReveal(endpoint), { signal })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(body?.error?.code ?? (res.status === 404 ? 'BOOK_NOT_FOUND' : 'DOWNLOAD_FAILED'), body?.error?.message ?? 'Book download failed')
  }
  const blob = await res.blob()
  const dispositionName = res.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  let filename = `${safeDownloadFileName(book.title)}.${book.format}`
  if (dispositionName && !rawEpub) {
    try { filename = safeDownloadFileName(decodeURIComponent(dispositionName)) } catch { /* Keep the fallback filename. */ }
  }
  return { blob, filename }
}

export function prepareBookFile(book: BookDownloadRequest, signal?: AbortSignal) {
  return fetchBookFile(book, signal)
}

function uniqueArchiveName(filename: string, used: Set<string>) {
  const safeName = safeDownloadFileName(filename)
  const dot = safeName.lastIndexOf('.')
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName
  const extension = dot > 0 ? safeName.slice(dot) : ''
  let candidate = safeName
  let index = 2
  while (used.has(candidate.toLocaleLowerCase())) candidate = `${stem} (${index++})${extension}`
  used.add(candidate.toLocaleLowerCase())
  return candidate
}

export async function createBooksArchive(files: PreparedBookFile[], signal?: AbortSignal) {
  const output = new BlobWriter('application/zip')
  const zip = new ZipWriter(output, { useWebWorkers: false })
  const used = new Set<string>()
  try {
    for (const file of files) {
      signal?.throwIfAborted()
      await zip.add(uniqueArchiveName(file.filename, used), new BlobReader(file.blob), {
        level: file.blob.type.includes('epub') ? 0 : 6,
        signal,
      })
    }
    signal?.throwIfAborted()
    await zip.close()
    return await output.getData()
  } catch (error) {
    try {
      await output.writable.abort(error)
    } catch {
      // The writable can already be errored or closed when an entry is cancelled.
    }
    throw error
  }
}

export function deliverBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function downloadBook(bookId: string, title: string) {
  const res = await fetch(withReveal(`${BASE_URL}/books/${bookId}/file`))
  if (!res.ok) {
    throw new ApiError(res.status === 404 ? 'BOOK_NOT_FOUND' : 'DOWNLOAD_FAILED', 'Book download failed')
  }
  const blob = await res.blob()
  const safeName = title.replace(/[^\w　-〿＀-￯一-龥-]/g, '_')
  const ext = blob.type.includes('epub') ? 'epub' : blob.type.includes('plain') ? 'txt' : 'epub'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}.${ext}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// P4: export downloads throw on failure so callers can show a localized error.
async function downloadExport(
  bookId: string,
  title: string,
  endpoint: string,
  fileName: string,
) {
  const res = await fetch(withReveal(`${BASE_URL}/books/${bookId}/${endpoint}`))
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(body?.error?.code ?? 'EXPORT_FAILED', body?.error?.message ?? 'Book export failed')
  }
  const blob = await res.blob()
  const safeName = title.replace(/[^\w　-〿＀-￯一-龥-]/g, '_')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const serverName = res.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  let filename = `${safeName}${fileName}`
  if (serverName) {
    try { filename = decodeURIComponent(serverName).replace(/[\\/:*?"<>|]/g, '_') } catch { /* Keep the fallback filename. */ }
  }
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Edited TXT: normalized text with the user's effective replacements applied */
export function downloadEditedTxt(bookId: string, title: string) {
  return downloadExport(bookId, title, 'export.txt', '.校订版.txt')
}

/** The original-ish TXT (normalized, untransformed) — the closest to the
 *  uploaded file the server can produce (raw bytes are not stored) */
export function downloadOriginalTxt(bookId: string, title: string) {
  return downloadExport(bookId, title, 'export.txt?plain=1', '.txt')
}

/** Edited EPUB: freshly regenerated from the book with replacements applied */
export function downloadEpub(bookId: string, title: string, opts: { plain?: boolean } = {}) {
  return downloadExport(
    bookId,
    title,
    `export.epub${opts.plain ? '?plain=1' : ''}`,
    opts.plain ? '.epub' : '-校订版.epub',
  )
}

async function convertBlobToPng(blob: Blob): Promise<Blob> {
  const imgBitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = imgBitmap.width
  canvas.height = imgBitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')
  ctx.drawImage(imgBitmap, 0, 0)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error('Failed to convert image to PNG'))
    }, 'image/png')
  })
}

export async function downloadCover(bookId: string, title: string) {
  const res = await fetch(`${BASE_URL}/books/${bookId}/cover?size=original`)
  if (!res.ok) {
    throw new ApiError(res.status === 404 ? 'BOOK_NOT_FOUND' : 'DOWNLOAD_FAILED', 'Cover download failed')
  }
  const blob = await res.blob()
  const safeName = title.replace(/[^\w　-〿＀-￯一-龥-]/g, '_')
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : blob.type === 'image/svg+xml' ? 'svg' : 'jpg'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}-封面.${ext}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function copyCover(bookId: string) {
  const res = await fetch(`${BASE_URL}/books/${bookId}/cover?size=original`)
  if (!res.ok) {
    throw new ApiError(res.status === 404 ? 'BOOK_NOT_FOUND' : 'DOWNLOAD_FAILED', 'Cover copy failed')
  }
  const blob = await res.blob()
  let pngBlob = blob
  if (blob.type !== 'image/png') {
    pngBlob = await convertBlobToPng(blob)
  }
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': pngBlob }),
  ])
}
