import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut, apiDelete } from '@/api/client'
import type { AnnotationRes, AnnotationCreateReq, AnnotationUpdateReq } from '@bookdock/shared'

export function useAnnotations(bookId: string) {
  return useQuery({
    queryKey: ['annotations', bookId],
    queryFn: () => apiGet<{ data: AnnotationRes[] }>(`/annotations/book/${bookId}`),
    enabled: !!bookId,
  })
}

export function useCreateAnnotation(bookId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AnnotationCreateReq) =>
      apiPost<{ data: AnnotationRes }>(`/annotations/book/${bookId}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['annotations', bookId] }),
  })
}

export function useUpdateAnnotation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AnnotationUpdateReq }) =>
      apiPut<{ data: AnnotationRes }>(`/annotations/${id}`, body),
    onSuccess: (_, _vars) => {
      queryClient.invalidateQueries({ queryKey: ['annotations'] })
    },
  })
}

export function useDeleteAnnotation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/annotations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['annotations'] }),
  })
}
