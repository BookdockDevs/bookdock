import { useAuthStore } from '@/stores/auth.store'
import { useDownloadStore } from '@/stores/download.store'

import { isDeviceBook } from '@/features/reading-data/book-source'

import DownloadDialog from './DownloadDialog'

export default function DownloadDialogHost() {
  const target = useDownloadStore((state) => state.target)
  const targetUserId = useDownloadStore((state) => state.userId)
  const close = useDownloadStore((state) => state.close)
  const user = useAuthStore((state) => state.user)
  if (!target) return null
  const local = target.every((book) => isDeviceBook(book.ref))
  if (!local && (!user || user.id !== targetUserId)) return null
  const books = target.map(({ bookVersionId, ...book }) => ({ ...book, id: bookVersionId ?? book.id }))
  return <DownloadDialog key={`${local ? JSON.stringify(books[0].ref?.scope) : user!.id}:${books.map((book) => book.id).join('|')}`} books={books} userId={local ? null : user!.id} onClose={close} />
}
