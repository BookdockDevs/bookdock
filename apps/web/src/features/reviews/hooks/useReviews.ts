import { useRef } from 'react'
import { interactionRequestId } from '@/lib/interaction-request'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ArchivePage, MyReviewEntry, ReaderProfile, ReviewBookContext, ReviewDiscussion } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut } from '@/api/client'

export function useReviewBookContext(bookVersionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['reviews', 'book', bookVersionId],
    queryFn: () => apiGet<{ data: ReviewBookContext }>(`/reviews/by-book/${bookVersionId}`),
    enabled: Boolean(bookVersionId) && enabled,
    staleTime: 0,
  })
}

export function useReviewWorkContext(libraryId: string | null, libraryBookId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['reviews', 'work', libraryId, libraryBookId],
    queryFn: () =>
      apiGet<{ data: ReviewBookContext }>(
        `/reviews/work?${new URLSearchParams({ libraryId: libraryId!, libraryBookId: libraryBookId! })}`,
      ),
    enabled: Boolean(libraryId) && Boolean(libraryBookId) && enabled,
    staleTime: 0,
  })
}

export function useReviewDiscussion(reviewId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['reviews', 'discussion', reviewId],
    queryFn: () => apiGet<{ data: ReviewDiscussion }>(`/reviews/${reviewId}`),
    enabled: Boolean(reviewId) && enabled,
    staleTime: 0,
  })
}

export function useMyReviews(enabled = true, page = 1) {
  return useQuery({
    queryKey: ['reviews', 'mine', page],
    queryFn: () => apiGet<{ data: ArchivePage<MyReviewEntry> }>(`/reviews/mine?page=${page}`),
    enabled,
    staleTime: 0,
  })
}

export function useReaderProfile(userId: string | undefined, page = 1) {
  return useQuery({
    queryKey: ['reviews', 'author', userId, page],
    queryFn: () => apiGet<{ data: ReaderProfile }>(`/reviews/author/${encodeURIComponent(userId!)}?page=${page}`),
    enabled: Boolean(userId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
}

export interface SaveReviewInput {
  bookVersionId: string
  reviewId?: string | null
  rating: number | null
  body: string | null
  /** Omitted on untouched edits so the server retains the stored visibility. */
  visibility?: 'private' | 'shared'
}

export function useSaveReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveReviewInput) => {
      const payload = { rating: input.rating, body: input.body, visibility: input.visibility }
      if (input.reviewId) return apiPut<{ data: unknown }>(`/reviews/${input.reviewId}`, payload)
      return apiPost<{ data: unknown }>('/reviews', { ...payload, bookVersionId: input.bookVersionId })
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reviews'] })
    },
  })
}

export function useDeleteReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reviewId: string) => apiDelete(`/reviews/${reviewId}`),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reviews'] })
    },
  })
}

export type ReviewAction =
  | { type: 'like'; liked: boolean; commentId?: string }
  | { type: 'comment'; body: string; replyToId?: string }
  | { type: 'edit'; commentId: string; body: string }
  | { type: 'delete'; commentId: string }

export function useReviewAction(reviewId: string) {
  const queryClient = useQueryClient()
  const pendingComment = useRef<{ signature: string; requestId: string } | null>(null)
  return useMutation({
    mutationFn: (action: ReviewAction) => {
      const path = `/reviews/${reviewId}`
      if (action.type === 'comment') {
        const signature = JSON.stringify([reviewId, action.body, action.replyToId])
        if (pendingComment.current?.signature !== signature) pendingComment.current = { signature, requestId: interactionRequestId() }
        return apiPost(`${path}/comments`, { body: action.body, replyToId: action.replyToId, requestId: pendingComment.current.requestId })
      }
      if (action.type === 'edit') return apiPut(`${path}/comments/${action.commentId}`, { body: action.body })
      if (action.type === 'delete') return apiDelete(`${path}/comments/${action.commentId}`)
      return apiPut(action.commentId ? `${path}/comments/${action.commentId}/like` : `${path}/like`, { liked: action.liked })
    },
    onSuccess: (_, action) => { if (action.type === 'comment') pendingComment.current = null },
    onMutate: async (action) => {
      if (action.type !== 'like') return undefined
      await queryClient.cancelQueries({ queryKey: ['reviews', 'discussion', reviewId] })
      const prev = queryClient.getQueriesData<{ data: ReviewDiscussion }>({ queryKey: ['reviews', 'discussion', reviewId] })
      queryClient.setQueriesData<{ data: ReviewDiscussion }>(
        { queryKey: ['reviews', 'discussion', reviewId] },
        (old) => {
          if (!old?.data) return old
          if (action.commentId) {
            return {
              ...old,
              data: {
                ...old.data,
                comments: old.data.comments.map((comment) => {
                  if (comment.id !== action.commentId) return comment
                  const diff = action.liked ? (comment.liked ? 0 : 1) : comment.liked ? -1 : 0
                  return { ...comment, liked: action.liked, likeCount: Math.max(0, comment.likeCount + diff) }
                }),
              },
            }
          }
          const diff = action.liked ? (old.data.review.liked ? 0 : 1) : old.data.review.liked ? -1 : 0
          return {
            ...old,
            data: {
              ...old.data,
              review: { ...old.data.review, liked: action.liked, likeCount: Math.max(0, old.data.review.likeCount + diff) },
            },
          }
        },
      )
      return { prev }
    },
    onError: (_err, _action, context) => {
      if (context?.prev) {
        for (const [key, data] of context.prev) queryClient.setQueryData(key, data)
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reviews'] })
    },
  })
}
