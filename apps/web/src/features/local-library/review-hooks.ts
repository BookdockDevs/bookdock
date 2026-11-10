import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ClientBookRef, ClientReviewInput } from '@bookdock/shared'
import { clientBookKey } from '@bookdock/shared'

import type { SaveReviewInput } from '@/features/reviews/hooks/useReviews'

import { isDeviceBook } from '@/features/reading-data/book-source'
import { localLibraryRepository } from './repository'
import { localRatingHalves } from './reviews'

/** One conversion for both the archive and the book detail composer. */
export function localReviewMutationInput(input: SaveReviewInput, expectedVersion?: number) {
  return {
    ratingHalves: localRatingHalves(input.rating),
    title: input.title?.trim() ?? '',
    body: input.body ?? '',
    bodyFormat: (input.bodyFormat ?? 'markdown') as 'plain' | 'markdown',
    expectedVersion,
  }
}

export function localReviewQueryKey(ref: ClientBookRef | null) {
  return ['local-library', 'review', ...(ref ? clientBookKey(ref) : ['none'])] as const
}

/** The device book's single review row, or null. Never touches the network. */
export function useLocalReview(ref: ClientBookRef | null) {
  return useQuery({
    queryKey: localReviewQueryKey(ref),
    networkMode: 'always',
    queryFn: () => localLibraryRepository.getReview(ref!),
    enabled: isDeviceBook(ref),
    staleTime: 30_000,
  })
}

function useReviewInvalidation(ref: ClientBookRef | null) {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: localReviewQueryKey(ref) }),
      // Archive counts, cards and overview all read the same vault snapshot.
      queryClient.invalidateQueries({ queryKey: ['archive'] }),
      queryClient.invalidateQueries({ queryKey: ['reading-records'] }),
    ])
  }
}

export function useSaveLocalReview(ref: ClientBookRef | null) {
  const invalidate = useReviewInvalidation(ref)
  return useMutation({
    networkMode: 'always',
    mutationFn: (input: ClientReviewInput & { expectedVersion?: number }) => {
      const { expectedVersion, ...review } = input
      return localLibraryRepository.saveReview(ref!, review, expectedVersion)
    },
    onSuccess: invalidate,
  })
}

export function useDeleteLocalReview(ref: ClientBookRef | null) {
  const invalidate = useReviewInvalidation(ref)
  return useMutation({
    networkMode: 'always',
    mutationFn: (expectedVersion?: number) => localLibraryRepository.deleteReview(ref!, expectedVersion),
    onSuccess: invalidate,
  })
}
