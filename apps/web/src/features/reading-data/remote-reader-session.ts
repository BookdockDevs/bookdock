import type { BookDetailRes, ReaderBookSettings, ReadingProgressRes, ReadingProgressUpdateReq, ViewSettings } from '@bookdock/shared'
import { apiGet, apiPatch, apiPut } from '@/api/client'
import { withReveal } from '@/lib/reveal-hidden'
import { getGuestProgress, saveGuestProgress } from '../reader/lib/guest-progress'

export function remoteReaderSession(bookId: string, guest: boolean) {
  const base = `/books/${encodeURIComponent(bookId)}`
  return {
    getBook: () => apiGet<{ data: BookDetailRes }>(withReveal(base)),
    getProgress: () => guest ? Promise.resolve({ data: getGuestProgress(bookId) }) : apiGet<{ data: ReadingProgressRes | null }>(withReveal(`/progress/${encodeURIComponent(bookId)}`)),
    saveProgress: (body: ReadingProgressUpdateReq) => guest ? Promise.resolve({ data: saveGuestProgress(bookId, body) }) : apiPut<{ data: ReadingProgressRes | null }>(withReveal(`/progress/${encodeURIComponent(bookId)}`), body),
    saveSettings: (viewSettings: ViewSettings | null) => apiPatch<{ data: ReaderBookSettings }>(withReveal(`${base}/reader-settings`), { viewSettings }),
    bindPreset: (boundPresetId: string | null) => apiPatch<{ data: ReaderBookSettings }>(withReveal(`${base}/reader-settings`), { boundPresetId }),
    contentUrl: (book: Pick<BookDetailRes, 'revisionId' | 'updatedAt'>) => withReveal(`/api/v1/books/${encodeURIComponent(bookId)}/file?reader=1&revisionId=${encodeURIComponent(book.revisionId ?? '')}&v=${book.updatedAt}`),
  }
}
