import { useAuthStore } from '@/stores/auth.store'
import { useDownloadStore } from '@/stores/download.store'

import DownloadDialog from './DownloadDialog'

export default function DownloadDialogHost() {
  const target = useDownloadStore((state) => state.target)
  const targetUserId = useDownloadStore((state) => state.userId)
  const close = useDownloadStore((state) => state.close)
  const user = useAuthStore((state) => state.user)
  if (!target || !user || user.id !== targetUserId) return null
  const books = target.map(({ bookVersionId, ...book }) => ({ ...book, id: bookVersionId ?? book.id }))
  return <DownloadDialog key={`${user.id}:${books.map((book) => book.id).join('|')}`} books={books} userId={user.id} onClose={close} />
}
