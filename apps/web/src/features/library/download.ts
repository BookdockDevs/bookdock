import { ApiError, BASE_URL } from '@/api/client'

export async function downloadBook(bookId: string, title: string) {
  const res = await fetch(`${BASE_URL}/books/${bookId}/file`)
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
  const res = await fetch(`${BASE_URL}/books/${bookId}/${endpoint}`)
  if (!res.ok) {
    throw new ApiError(res.status === 404 ? 'BOOK_NOT_FOUND' : 'EXPORT_FAILED', 'Book export failed')
  }
  const blob = await res.blob()
  const safeName = title.replace(/[^\w　-〿＀-￯一-龥-]/g, '_')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}${fileName}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Edited TXT: normalized text with the user's effective transforms applied */
export function downloadEditedTxt(bookId: string, title: string) {
  return downloadExport(bookId, title, 'export.txt', '.校订版.txt')
}

/** The original-ish TXT (normalized, untransformed) — the closest to the
 *  uploaded file the server can produce (raw bytes are not stored) */
export function downloadOriginalTxt(bookId: string, title: string) {
  return downloadExport(bookId, title, 'export.txt?plain=1', '.txt')
}

/** Edited EPUB: freshly regenerated from the book with transforms applied */
export function downloadEpub(bookId: string, title: string, opts: { plain?: boolean } = {}) {
  return downloadExport(
    bookId,
    title,
    `export.epub${opts.plain ? '?plain=1' : ''}`,
    opts.plain ? '.epub' : '-校订版.epub',
  )
}

/** Default download for the card context menu: TXT books get a freshly
 *  generated EPUB (no rules ⇒ the server output equals the original), EPUB
 *  books keep the stored-file download. */
export async function downloadDefault(book: { id: string; title: string; format: string }) {
  if (book.format === 'txt') {
    await downloadEpub(book.id, book.title)
  } else {
    await downloadBook(book.id, book.title)
  }
}
