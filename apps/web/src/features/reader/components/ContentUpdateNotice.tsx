import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { BookDetailRes } from '@bookdock/shared'

import { apiPut } from '@/api/client'
import { notify } from '@/lib/notifications'
import { withReveal } from '@/lib/reveal-hidden'

interface ContentUpdateNoticeProps {
  bookId: string
  book?: BookDetailRes
  ready: boolean
  guest: boolean
}

export default function ContentUpdateNotice({ bookId, book, ready, guest }: ContentUpdateNoticeProps) {
  const queryClient = useQueryClient()
  const unreadUpdate = useRef(false)
  const shownFor = useRef<string | null>(null)
  const acknowledged = useRef<string | null>(null)
  const { mutate } = useMutation({
    mutationFn: ({ id, revisionId }: { id: string; revisionId: string }) =>
      apiPut(withReveal(`/books/${id}/read-revision`), { revisionId }),
    retry: 1,
    onSuccess: (_data, { id, revisionId }) => {
      // A delayed acknowledgment must not clear a newer revision's notice.
      for (const key of [['books', 'detail', id], ['book', id]]) {
        queryClient.setQueryData<{ data: BookDetailRes }>(key, (old) =>
          old?.data.revisionId === revisionId
            ? { ...old, data: { ...old.data, hasUnreadUpdate: false } }
            : old,
        )
      }
    },
  })

  useEffect(() => {
    if (!book || book.id !== bookId) return
    if (shownFor.current !== bookId) {
      shownFor.current = bookId
      unreadUpdate.current = Boolean(book.hasUnreadUpdate)
    }
    if (ready && !guest && unreadUpdate.current) {
      unreadUpdate.current = false
      notify.info({ key: 'reader.contentUpdated' })
    }
    const revisionId = book.revisionId
    const key = `${bookId}:${revisionId}`
    if (ready && !guest && revisionId && acknowledged.current !== key) {
      acknowledged.current = key
      mutate({ id: bookId, revisionId })
    }
  }, [book, bookId, ready, guest, mutate])

  return null
}
