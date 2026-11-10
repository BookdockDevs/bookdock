import { useRef } from 'react'
import { interactionRequestId } from '@/lib/interaction-request'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AnnotationRes, BookDetailRes, IdeaComposerContext, IdeaDiscussion, ReaderIdea } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut } from '@/api/client'
import { withReveal } from '@/lib/reveal-hidden'
import { invalidateActivityQueries } from '@/features/activity/hooks'
import { useAuthStore } from '@/stores/auth.store'
import { useLocalReader } from '../../reading-data/reader-source-context'

export function useIdeaComposer(bookId: string, enabled = true) {
  const local = useLocalReader()
  return useQuery({
    queryKey: ['idea-composer', local?.namespace ?? bookId],
    networkMode: local ? 'always' : 'online',
    queryFn: () => local ? Promise.resolve({ data: { eligible: false, sourceReadable: true, defaultVisibility: 'private' as const, revisionId: null } }) : apiGet<{ data: IdeaComposerContext }>(`/ideas/book/${bookId}/composer`),
    enabled: !!bookId && (enabled || !!local),
    staleTime: 30_000,
  })
}

export function useReaderIdeas(bookId: string, enabled = true, displayedRevisionId?: string | null) {
  const local = useLocalReader()
  const book = useQuery({
    queryKey: ['book', local?.namespace ?? bookId],
    queryFn: () => local ? local.getBook() : apiGet<{ data: BookDetailRes }>(withReveal(`/books/${bookId}`)),
    enabled: !!bookId && !local,
  })
  const source = book.data?.data.source
  const revisionId = displayedRevisionId ?? book.data?.data.revisionId
  return useQuery({
    queryKey: ['reader-ideas', local?.namespace ?? bookId, source?.libraryId, source?.libraryBookVersionId, revisionId],
    queryFn: () => apiGet<{ data: ReaderIdea[] }>(`/ideas/book/${bookId}?${new URLSearchParams({ libraryId: source!.libraryId, listingId: source!.libraryBookVersionId!, revisionId: revisionId! })}`),
    enabled: !local && enabled && !!source?.libraryBookVersionId && !!revisionId,
    staleTime: 30_000,
  })
}

export function useIdeaDiscussion(ideaId: string | null, bookId: string) {
  const local = useLocalReader()
  const queryClient = useQueryClient()
  const revisionId = queryClient.getQueryData<{ data: BookDetailRes }>(['book', bookId])?.data.revisionId
  return useQuery({
    queryKey: ['idea-discussion', ideaId, revisionId],
    queryFn: () => apiGet<{ data: IdeaDiscussion }>(`/ideas/${ideaId}${revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : ''}`),
    enabled: !local && !!ideaId && !ideaId.startsWith('temp-'),
    staleTime: 30_000,
  })
}

export type IdeaAction =
  | { type: 'like'; liked: boolean; commentId?: string }
  | { type: 'comment'; body: string; replyToId?: string }
  | { type: 'edit'; commentId: string; body: string }
  | { type: 'delete'; commentId: string }

export function useIdeaAction(ideaId: string, bookId: string) {
  const local = useLocalReader()
  const queryClient = useQueryClient()
  const pendingComment = useRef<{ signature: string; requestId: string } | null>(null)
  return useMutation({
    mutationFn: (action: IdeaAction) => {
      if (local) throw new Error('Local notes do not have a server discussion')
      const path = `/ideas/${ideaId}`
      if (action.type === 'comment') {
        const signature = JSON.stringify([ideaId, action.body, action.replyToId])
        if (pendingComment.current?.signature !== signature) pendingComment.current = { signature, requestId: interactionRequestId() }
        return apiPost(`${path}/comments`, { body: action.body, replyToId: action.replyToId, requestId: pendingComment.current.requestId })
      }
      if (action.type === 'edit') return apiPut(`${path}/comments/${action.commentId}`, { body: action.body })
      if (action.type === 'delete') return apiDelete(`${path}/comments/${action.commentId}`)
      return apiPut(action.commentId ? `${path}/comments/${action.commentId}/like` : `${path}/like`, { liked: action.liked })
    },
    onSuccess: (_, action) => { if (action.type === 'comment') pendingComment.current = null },
    onMutate: async (action) => {
      if (local) throw new Error('Local notes do not have a server discussion')
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
    onSettled: async (_result, _error, action) => {
      if (local) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['note-archive'] }),
        queryClient.invalidateQueries({ queryKey: ['idea-discussion', ideaId] }),
        queryClient.invalidateQueries({ queryKey: ['reader-ideas', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['annotations', bookId] }),
        // Comment/like writes can retire the notifications pointing at them.
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        ...(action.type === 'delete' ? [invalidateActivityQueries(queryClient)] : []),
      ])
    },
  })
}

export function useToggleIdeaLike(bookId: string) {
  const local = useLocalReader()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ideaId, liked }: { ideaId: string; liked: boolean }) => {
      if (local) throw new Error('Local notes do not have a server discussion')
      return apiPut(`/ideas/${ideaId}/like`, { liked })
    },
    onMutate: async ({ ideaId, liked }) => {
      if (local) throw new Error('Local notes do not have a server discussion')
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
      if (local) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reader-ideas', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['idea-discussion', ideaId] }),
        queryClient.invalidateQueries({ queryKey: ['annotations', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ])
    },
  })
}
