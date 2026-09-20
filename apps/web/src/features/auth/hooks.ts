import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import type {
  AccountRes,
  AdminUserRes,
  ChangePasswordReq,
  InstanceInfoRes,
  LoginReq,
  LoginRes,
  RegisterReq,
  RegisterRes,
  UpdateInstanceReq,
  UpdateUserReq,
  UpdateUsernameReq,
} from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'

export const INSTANCE_QUERY_KEY = ['auth', 'instance'] as const
export const ME_QUERY_KEY = ['auth', 'me'] as const
export const ADMIN_USERS_QUERY_KEY = ['admin', 'users'] as const

export function useInstanceInfo() {
  return useQuery({
    queryKey: INSTANCE_QUERY_KEY,
    queryFn: () => apiGet<{ data: InstanceInfoRes }>('/auth/instance'),
    staleTime: 60_000,
    retry: false,
  })
}

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: LoginReq) => apiPost<{ data: LoginRes }>('/auth/login', body),
    onSuccess: async (res) => {
      setAuth(res.data.user)
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    },
  })
}

export function useRegister() {
  const setAuth = useAuthStore((s) => s.setAuth)
  return useMutation({
    mutationFn: (body: RegisterReq) => apiPost<{ data: RegisterRes }>('/auth/register', body),
    onSuccess: (res) => setAuth(res.data.user),
  })
}

export function useLogout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const clearAuth = useAuthStore((s) => s.clearAuth)
  return useMutation({
    mutationFn: () => apiPost<{ data: null }>('/auth/logout'),
    onSettled: () => {
      queryClient.clear()
      clearAuth()
      navigate({ to: '/login' })
    },
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordReq) => apiPost<{ data: { ok: true } }>('/auth/password', body),
  })
}

export function useUpdateUsername() {
  const updateUser = useAuthStore((s) => s.updateUser)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateUsernameReq) => apiPost<{ data: AccountRes }>('/auth/username', body),
    onSuccess: (res) => {
      updateUser({ username: res.data.username })
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    },
  })
}

export function useUploadAvatar() {
  const updateUser = useAuthStore((s) => s.updateUser)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => apiUpload<{ data: AccountRes }>('/avatars', file),
    onSuccess: (res) => {
      updateUser({ avatarKey: res.data.avatarKey })
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    },
  })
}

export function useDeleteAvatar() {
  const updateUser = useAuthStore((s) => s.updateUser)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiDelete<{ data: null }>('/avatars'),
    onSuccess: () => {
      updateUser({ avatarKey: null })
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    },
  })
}

export function useUpdateInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateInstanceReq) => apiPatch<{ data: InstanceInfoRes }>('/auth/instance', body),
    onSuccess: (res) => {
      queryClient.setQueryData(INSTANCE_QUERY_KEY, res)
    },
  })
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ADMIN_USERS_QUERY_KEY,
    queryFn: () => apiGet<{ data: AdminUserRes[] }>('/users'),
    staleTime: 30_000,
    retry: false,
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateUserReq & { id: string }) =>
      apiPatch<{ data: AdminUserRes }>(`/users/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_USERS_QUERY_KEY })
    },
  })
}
