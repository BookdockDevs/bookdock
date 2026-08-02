import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import type {
  AdminUserRes,
  ChangePasswordReq,
  InstanceInfoRes,
  LoginReq,
  LoginRes,
  RegisterReq,
  RegisterRes,
  UpdateInstanceReq,
  UpdateUserReq,
} from '@bookdock/shared'

import { apiGet, apiPatch, apiPost } from '@/api/client'
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
  return useMutation({
    mutationFn: (body: LoginReq) => apiPost<{ data: LoginRes }>('/auth/login', body),
    onSuccess: (res) => setAuth(res.data.user),
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
