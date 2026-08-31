import { useAuthStore } from '@/stores/auth.store'

import type { AiChatReq, AiCitation, AiContextReceipt } from '@bookdock/shared'

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
  return new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? res.statusText, body?.error?.details)
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

export async function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, signal })
}

export async function apiPostBlob(path: string, body: unknown, signal?: AbortSignal): Promise<Blob> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path)
    throw await parseError(res)
  }
  return res.blob()
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

export interface AiStreamHandlers {
  onMeta?: (event: { requestId: string; threadId?: string; model?: string; receipt: AiContextReceipt }) => void
  onDelta?: (text: string) => void
  onUsage?: (event: { inputTokens?: number; outputTokens?: number }) => void
  onTool?: (event: { name: string; phase: 'start' | 'result'; chapterIndex?: number; resultChars?: number; citations?: AiCitation[] }) => void
}

export async function apiStreamAiChat(body: AiChatReq, handlers: AiStreamHandlers, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${BASE_URL}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized('/ai/chat')
    throw await parseError(res)
  }
  if (!res.body) throw new ApiError('AI_PROVIDER_ERROR', 'AI stream is empty')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const consume = (block: string) => {
    const lines = block.split(/\r?\n/)
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
    if (!event || !data) return
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      throw new ApiError('AI_PROVIDER_ERROR', 'AI stream returned invalid data')
    }
    if (event === 'meta' && parsed && typeof parsed === 'object' && 'receipt' in parsed) {
      const value = parsed as { requestId?: unknown; threadId?: unknown; model?: unknown; receipt: AiContextReceipt }
      if (typeof value.requestId === 'string') handlers.onMeta?.({ requestId: value.requestId, threadId: typeof value.threadId === 'string' ? value.threadId : undefined, model: typeof value.model === 'string' ? value.model : undefined, receipt: value.receipt })
    } else if (event === 'delta' && parsed && typeof parsed === 'object' && typeof (parsed as { text?: unknown }).text === 'string') {
      handlers.onDelta?.((parsed as { text: string }).text)
    } else if (event === 'usage' && parsed && typeof parsed === 'object') {
      handlers.onUsage?.(parsed as { inputTokens?: number; outputTokens?: number })
    } else if (event === 'tool' && parsed && typeof parsed === 'object') {
      const value = parsed as { name?: unknown; phase?: unknown; chapterIndex?: unknown; resultChars?: unknown; citations?: unknown }
      if (typeof value.name === 'string' && (value.phase === 'start' || value.phase === 'result')) {
        const citations = Array.isArray(value.citations) ? value.citations.flatMap((item): AiCitation[] => {
          if (!item || typeof item !== 'object') return []
          const citation = item as Record<string, unknown>
          if (
            typeof citation.id !== 'string' || !citation.id
            || typeof citation.chapterIndex !== 'number' || !Number.isInteger(citation.chapterIndex) || citation.chapterIndex < 0
            || typeof citation.chapterId !== 'string' || !citation.chapterId
            || typeof citation.chapterTitle !== 'string'
            || typeof citation.startOffset !== 'number' || !Number.isInteger(citation.startOffset) || citation.startOffset < 0
            || typeof citation.endOffset !== 'number' || !Number.isInteger(citation.endOffset) || citation.endOffset < citation.startOffset
            || typeof citation.excerpt !== 'string'
          ) return []
          return [{
            id: citation.id,
            chapterIndex: citation.chapterIndex,
            chapterId: citation.chapterId,
            chapterTitle: citation.chapterTitle,
            startOffset: citation.startOffset,
            endOffset: citation.endOffset,
            excerpt: citation.excerpt.slice(0, 240),
            ...(citation.sourceType === 'book' || citation.sourceType === 'annotation' ? { sourceType: citation.sourceType } : {}),
            ...(typeof citation.sourceCfi === 'string' && citation.sourceCfi ? { sourceCfi: citation.sourceCfi } : {}),
          }]
        }) : []
        handlers.onTool?.({
          name: value.name,
          phase: value.phase,
          ...(typeof value.chapterIndex === 'number' ? { chapterIndex: value.chapterIndex } : {}),
          ...(typeof value.resultChars === 'number' ? { resultChars: value.resultChars } : {}),
          ...(citations.length > 0 ? { citations } : {}),
        })
      }
    } else if (event === 'error') {
      const value = parsed as { code?: unknown; message?: unknown }
      throw new ApiError(typeof value.code === 'string' ? value.code : 'AI_PROVIDER_ERROR', typeof value.message === 'string' ? value.message : 'AI provider stream failed')
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let separator = buffer.indexOf('\n\n')
    while (separator >= 0) {
      consume(buffer.slice(0, separator))
      buffer = buffer.slice(separator + 2)
      separator = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  if (buffer.trim()) consume(buffer)
}
