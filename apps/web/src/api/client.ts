export const BASE_URL = '/api/v1'

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('bd-token') : null
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  })
  if (options?.headers) {
    const extra = new Headers(options.headers)
    extra.forEach((value, key) => headers.set(key, value))
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? res.statusText)
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

export async function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('bd-token') : null
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? res.statusText)
  }
  return res.json() as Promise<T>
}
