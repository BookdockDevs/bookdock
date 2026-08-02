import { useAuthStore } from '@/stores/auth.store'

export const BASE_URL = '/api/v1'

// Dispatched when a non-public request comes back 401; RootComponent listens
// and redirects to /login. An event keeps this module free of router imports.
export const UNAUTHORIZED_EVENT = 'bd:unauthorized'

const PUBLIC_AUTH_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/setup',
  '/auth/setup-required',
  '/auth/instance',
  '/auth/logout',
]

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

function handleUnauthorized(path: string) {
  if (PUBLIC_AUTH_PATHS.some((p) => path.startsWith(p))) return
  useAuthStore.getState().clearAuth()
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
}

async function parseError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}))
  return new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? res.statusText)
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (options?.headers) {
    const extra = new Headers(options.headers)
    extra.forEach((value, key) => headers.set(key, value))
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  })
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path)
    throw await parseError(res)
  }
  return res.json() as Promise<T>
}

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) })
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}

export async function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}

export async function apiUpload<T>(path: string, file: File, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    body: formData,
  })
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path)
    throw await parseError(res)
  }
  return res.json() as Promise<T>
}
