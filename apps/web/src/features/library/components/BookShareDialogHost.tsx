import { useAuthStore } from '@/stores/auth.store'
import { useBookShareStore } from '@/stores/book-share.store'

import BookShareDialog from './BookShareDialog'

export default function BookShareDialogHost() {
  const target = useBookShareStore((state) => state.target)
  const close = useBookShareStore((state) => state.close)
  const userId = useAuthStore((state) => state.user?.id)
  if (!target || target.userId !== userId) return null
  return <BookShareDialog key={JSON.stringify([userId, target.libraryId, target.versionId])} target={target} userId={userId} onClose={close} />
}
