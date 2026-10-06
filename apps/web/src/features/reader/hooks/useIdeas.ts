import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AnnotationRes, BookDetailRes, IdeaComposerContext, IdeaDiscussion, ReaderIdea } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut } from '@/api/client'
import { withReveal } from '@/lib/reveal-hidden'
import { useAuthStore } from '@/stores/auth.store'

export function useIdeaComposer(bookId: string, enabled = true) {
  return useQuery({
    queryKey: ['idea-composer', bookId],
    queryFn: () => apiGet<{ data: IdeaComposerContext }>(`/ideas/book/${bookId}/composer`),
    enabled: !!bookId && enabled,
    staleTime: 0,
  })
}

export function useReaderIdeas(bookId: string, enabled = true) {
  const book = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => apiGet<{ data: BookDetailRes }>(withReveal(`/books/${bookId}`)),
    enabled: !!bookId,
  })
  const source = book.data?.data.source
  const revisionId = book.data?.data.revisionId
  return useQuery({
    queryKey: ['reader-ideas', bookId, source?.libraryId, source?.libraryBookVersionId, revisionId],
    queryFn: () => apiGet<{ data: ReaderIdea[] }>(`/ideas/book/${bookId}?${new URLSearchParams({ libraryId: source!.libraryId, listingId: source!.libraryBookVersionId!, revisionId: revisionId! })}`),
    enabled: enabled && !!source?.libraryBookVersionId && !!revisionId,
    staleTime: 0,
  })
}

export function useIdeaDiscussion(ideaId: string | null, bookId: string) {
  const queryClient = useQueryClient()
  const revisionId = queryClient.getQueryData<{ data: BookDetailRes }>(['book', bookId])?.data.revisionId
  return useQuery({
    queryKey: ['idea-discussion', ideaId, revisionId],
    queryFn: () => apiGet<{ data: IdeaDiscussion }>(`/ideas/${ideaId}${revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : ''}`),
    enabled: !!ideaId && !ideaId.startsWith('temp-'),
    staleTime: 0,
  })
}

export type IdeaAction =
  | { type: 'like'; liked: boolean; commentId?: string }
  | { type: 'comment'; body: string; replyToId?: string }
  | { type: 'edit'; commentId: string; body: string }
  | { type: 'delete'; commentId: string }

export function useIdeaAction(ideaId: string, bookId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: IdeaAction) => {
      const path = `/ideas/${ideaId}`
      if (action.type === 'comment') return apiPost(`${path}/comments`, { body: action.body, replyToId: action.replyToId })
      if (action.type === 'edit') return apiPut(`${path}/comments/${action.commentId}`, { body: action.body })
      if (action.type === 'delete') return apiDelete(`${path}/comments/${action.commentId}`)
      return apiPut(action.commentId ? `${path}/comments/${action.commentId}/like` : `${path}/like`, { liked: action.liked })
    },
    onMutate: async (action) => {
      if (action.type === 'like') {
        const user = useAuthStore.getState().user
        await queryClient.cancelQueries({ queryKey: ['idea-discussion', ideaId] })
        await queryClient.cancelQueries({ queryKey: ['reader-ideas', bookId] })
        await queryClient.cancelQueries({ queryKey: ['annotations', bookId] })
        const prevDiscussion = queryClient.getQueriesData<{ data: IdeaDiscussion }>({ queryKey: ['idea-discussion', ideaId] })
        const prevReaderIdeas = queryClient.getQueriesData<{ data: ReaderIdea[] }>({ queryKey: ['reader-ideas', bookId] })
        const prevAnnotations = queryClient.getQueriesData<{ data: AnnotationRes[] }>({ queryKey: ['annotations', bookId] })

        queryClient.setQueriesData<{ data: IdeaDiscussion }>(
          { queryKey: ['idea-discussion', ideaId] },
          (old) => {
            if (!old?.data) return old
            if (action.commentId) {
              return {
                ...old,
                data: {
                  ...old.data,
                  comments: old.data.comments.map((comment) => {
                    if (comment.id !== action.commentId) return comment
                    const diff = action.liked ? (comment.liked ? 0 : 1) : (comment.liked ? -1 : 0)
                    return {
                      ...comment,
                      liked: action.liked,
                      likeCount: Math.max(0, comment.likeCount + diff),
                    }
                  }),
                },
              }
            }
            const diff = action.liked ? (old.data.idea.liked ? 0 : 1) : (old.data.idea.liked ? -1 : 0)
            let likers = old.data.likers ?? []
            if (action.liked && user) {
              if (!likers.some((l) => l.id === user.id)) {
                likers = [...likers, { id: user.id, name: user.username, avatarKey: user.avatarKey ?? null }]
              }
            } else if (!action.liked && user) {
              likers = likers.filter((l) => l.id !== user.id)
            }
            return {
              ...old,
              data: {
                ...old.data,
                idea: {
                  ...old.data.idea,
                  liked: action.liked,
                  likeCount: Math.max(0, old.data.idea.likeCount + diff),
                },
                likers,
              },
            }
          },
        )

        if (!action.commentId) {
          queryClient.setQueriesData<{ data: ReaderIdea[] }>(
            { queryKey: ['reader-ideas', bookId] },
            (old) => {
              if (!old?.data) return old
              return {
                ...old,
                data: old.data.map((item) => {
                  if (item.annotation.id !== ideaId) return item
                  const diff = action.liked ? (item.liked ? 0 : 1) : (item.liked ? -1 : 0)
                  return { ...item, liked: action.liked, likeCount: Math.max(0, item.likeCount + diff) }
                }),
              }
            },
          )

          queryClient.setQueriesData<{ data: AnnotationRes[] }>(
            { queryKey: ['annotations', bookId] },
            (old) => {
              if (!old?.data) return old
              return {
                ...old,
                data: old.data.map((item) => {
                  if (item.id !== ideaId) return item
                  const diff = action.liked ? (item.liked ? 0 : 1) : (item.liked ? -1 : 0)
                  return {
                    ...item,
                    liked: action.liked,
                    likeCount: Math.max(0, (item.likeCount ?? 0) + diff),
                  }
                }),
              }
            },
          )
        }

        return { prevDiscussion, prevReaderIdeas, prevAnnotations }
      }
    },
    onError: (_err, _action, context) => {
      if (context?.prevDiscussion) {
        for (const [key, data] of context.prevDiscussion) {
          queryClient.setQueryData(key, data)
        }
      }
      if (context?.prevReaderIdeas) {
        for (const [key, data] of context.prevReaderIdeas) {
          queryClient.setQueryData(key, data)
        }
      }
      if (context?.prevAnnotations) {
        for (const [key, data] of context.prevAnnotations) {
          queryClient.setQueryData(key, data)
        }
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['idea-discussion', ideaId] }),
        queryClient.invalidateQueries({ queryKey: ['reader-ideas', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['annotations', bookId] }),
      ])
    },
  })
}

export function useToggleIdeaLike(bookId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ideaId, liked }: { ideaId: string; liked: boolean }) =>
      apiPut(`/ideas/${ideaId}/like`, { liked }),
    onMutate: async ({ ideaId, liked }) => {
      const user = useAuthStore.getState().user
      await queryClient.cancelQueries({ queryKey: ['reader-ideas', bookId] })
      await queryClient.cancelQueries({ queryKey: ['idea-discussion', ideaId] })
      await queryClient.cancelQueries({ queryKey: ['annotations', bookId] })

      const prevReaderIdeas = queryClient.getQueriesData<{ data: ReaderIdea[] }>({ queryKey: ['reader-ideas', bookId] })
      const prevDiscussion = queryClient.getQueriesData<{ data: IdeaDiscussion }>({ queryKey: ['idea-discussion', ideaId] })
      const prevAnnotations = queryClient.getQueriesData<{ data: AnnotationRes[] }>({ queryKey: ['annotations', bookId] })

      queryClient.setQueriesData<{ data: ReaderIdea[] }>(
        { queryKey: ['reader-ideas', bookId] },
        (old) => {
          if (!old?.data) return old
          return {
            ...old,
            data: old.data.map((item) => {
              if (item.annotation.id !== ideaId) return item
              const diff = liked ? (item.liked ? 0 : 1) : (item.liked ? -1 : 0)
              return {
                ...item,
                liked,
                likeCount: Math.max(0, item.likeCount + diff),
              }
            }),
          }
        },
      )

      queryClient.setQueriesData<{ data: AnnotationRes[] }>(
        { queryKey: ['annotations', bookId] },
        (old) => {
          if (!old?.data) return old
          return {
            ...old,
            data: old.data.map((item) => {
              if (item.id !== ideaId) return item
              const diff = liked ? (item.liked ? 0 : 1) : (item.liked ? -1 : 0)
              return {
                ...item,
                liked,
                likeCount: Math.max(0, (item.likeCount ?? 0) + diff),
              }
            }),
          }
        },
      )

      queryClient.setQueriesData<{ data: IdeaDiscussion }>(
        { queryKey: ['idea-discussion', ideaId] },
        (old) => {
          if (!old?.data) return old
          const diff = liked ? (old.data.idea.liked ? 0 : 1) : (old.data.idea.liked ? -1 : 0)
          let likers = old.data.likers ?? []
          if (liked && user) {
            if (!likers.some((l) => l.id === user.id)) {
              likers = [...likers, { id: user.id, name: user.username, avatarKey: user.avatarKey ?? null }]
            }
          } else if (!liked && user) {
            likers = likers.filter((l) => l.id !== user.id)
          }
          return {
            ...old,
            data: {
              ...old.data,
              idea: {
                ...old.data.idea,
                liked,
                likeCount: Math.max(0, old.data.idea.likeCount + diff),
              },
              likers,
            },
          }
        },
      )

      return { prevReaderIdeas, prevDiscussion, prevAnnotations }
    },
    onError: (_err, _vars, context) => {
      if (context?.prevReaderIdeas) {
        for (const [key, data] of context.prevReaderIdeas) {
          queryClient.setQueryData(key, data)
        }
      }
      if (context?.prevDiscussion) {
        for (const [key, data] of context.prevDiscussion) {
          queryClient.setQueryData(key, data)
        }
      }
      if (context?.prevAnnotations) {
        for (const [key, data] of context.prevAnnotations) {
          queryClient.setQueryData(key, data)
        }
      }
    },
    onSettled: async (_, __, { ideaId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reader-ideas', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['idea-discussion', ideaId] }),
        queryClient.invalidateQueries({ queryKey: ['annotations', bookId] }),
      ])
    },
  })
}
