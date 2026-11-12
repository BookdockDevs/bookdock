import type { AiChatJobCreateReq, AiChatJobRes, AiChatReq, AiCitation, AiContextReceipt, AiLocalChatReq } from '@bookdock/shared'

import { DEFAULT_UNDO_QUERY_KEYS, publishUndoOpportunity } from '@/lib/undo'
import { getAuthSessionRevision, useAuthStore } from '@/stores/auth.store'

export const BASE_URL = '/api/v1'

export async function streamTranslation(input: import('@bookdock/shared').TranslationRequest | import('@bookdock/shared').SelectedTextTranslationRequest, signal: AbortSignal, onText: (text: string) => void) {
  const revision = getAuthSessionRevision()
  if (!useAuthStore.getState().user) throw new ApiError('UNAUTHORIZED', 'Login required')
  const controller = new AbortController()
  const unsubscribe = useAuthStore.subscribe(() => { if (getAuthSessionRevision() !== revision) controller.abort() })
  const requestSignal = AbortSignal.any([signal, controller.signal])
  const path = 'bookId' in input ? '/translation/translate' : '/translation/selected-text'
  try {
    requestSignal.throwIfAborted()
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST', credentials: 'same-origin', signal: requestSignal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    if (response.status === 401) handleUnauthorized(path, revision)
    if (requestSignal.aborted) {
      await response.body?.cancel().catch(() => {})
      requestSignal.throwIfAborted()
    }
    requestSignal.throwIfAborted()
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null)
      throw new ApiError(body?.error?.code ?? 'AI_PROVIDER_ERROR', body?.error?.message ?? 'Translation failed')
    }
    const reader = response.body.getReader()
    const cancel = () => { void reader.cancel().catch(() => {}) }
    requestSignal.addEventListener('abort', cancel, { once: true })
    const decoder = new TextDecoder()
    let buffer = ''
    let completed = false
    const consume = (line: string) => {
      requestSignal.throwIfAborted()
      if (!line.trim()) return
      const event = JSON.parse(line) as import('@bookdock/shared').TranslationEvent
      if (event.type === 'delta') onText(event.text)
      else if (event.type === 'done') completed = true
      else if (event.type === 'error') throw new ApiError(event.code, event.message)
      else throw new ApiError('AI_PROVIDER_ERROR', 'Invalid translation response')
    }
    try {
      while (true) {
        const { value, done } = await reader.read()
        requestSignal.throwIfAborted()
        buffer += decoder.decode(value, { stream: !done })
        let end = buffer.indexOf('\n')
        while (end >= 0) {
          consume(buffer.slice(0, end))
          buffer = buffer.slice(end + 1)
          end = buffer.indexOf('\n')
        }
        if (done) break
      }
      consume(buffer)
      if (!completed) throw new ApiError('AI_PROVIDER_ERROR', 'Translation was interrupted')
    } finally {
      requestSignal.removeEventListener('abort', cancel)
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } finally {
    unsubscribe()
  }
}

// Dispatched when a non-public request comes back 401; RootComponent listens
// and redirects to /login. An event keeps this module free of router imports.
export const UNAUTHORIZED_EVENT = 'bd:unauthorized'

function undoQueryKeys(path: string, method = 'GET'): readonly (readonly unknown[])[] {
  const singleBook = path.split('?')[0]?.match(/^\/books\/([^/]+)$/)
  if (method === 'PATCH' && singleBook) {
    const bookId = decodeURIComponent(singleBook[1]!)
    return [['books'], ['books', 'detail', bookId], ['book', bookId]]
  }
  if (path === '/annotations/batch-delete' || (method === 'DELETE' && /^\/annotations\//.test(path))) {
    return [['annotations'], ['note-archive'], ['idea-discussion'], ['notifications'], ['activity']]
  }
  if (method === 'DELETE' && /^\/libraries\//.test(path)) {
    return [['libraries'], ['library']]
  }
  return DEFAULT_UNDO_QUERY_KEYS
}

const PUBLIC_AUTH_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/setup',
  '/auth/setup-required',
  '/auth/instance',
  '/auth/me',
  '/auth/logout',
]

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
    public status?: number,
  ) {
    super(message)
  }
}

function handleUnauthorized(path: string, requestSessionRevision?: number) {
  if (requestSessionRevision !== undefined && requestSessionRevision !== getAuthSessionRevision()) return
  if (path.startsWith('/auth/me')) {
    useAuthStore.getState().clearAuth()
    return
  }
  if (PUBLIC_AUTH_PATHS.some((p) => path.startsWith(p))) return
  useAuthStore.getState().clearAuth()
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
}

function parseAiCitation(value: unknown): AiCitation | null {
  if (!value || typeof value !== 'object') return null
  const citation = value as Record<string, unknown>
  if (
    typeof citation.id !== 'string' || !citation.id
    || typeof citation.chapterIndex !== 'number' || !Number.isInteger(citation.chapterIndex) || citation.chapterIndex < 0
    || typeof citation.chapterId !== 'string' || !citation.chapterId
    || typeof citation.chapterTitle !== 'string'
    || typeof citation.startOffset !== 'number' || !Number.isInteger(citation.startOffset) || citation.startOffset < 0
    || typeof citation.endOffset !== 'number' || !Number.isInteger(citation.endOffset) || citation.endOffset < citation.startOffset
    || typeof citation.excerpt !== 'string'
  ) return null
  return {
    id: citation.id,
    chapterIndex: citation.chapterIndex,
    chapterId: citation.chapterId,
    chapterTitle: citation.chapterTitle,
    startOffset: citation.startOffset,
    endOffset: citation.endOffset,
    excerpt: citation.excerpt.slice(0, 240),
    ...(citation.sourceType === 'book' || citation.sourceType === 'annotation' ? { sourceType: citation.sourceType } : {}),
    ...(typeof citation.sourceCfi === 'string' && citation.sourceCfi ? { sourceCfi: citation.sourceCfi } : {}),
  }
}

async function parseError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}))
  const code = body?.error?.code ?? (res.status === 403 ? 'FORBIDDEN' : res.status === 401 ? 'UNAUTHORIZED' : 'UNKNOWN')
  return new ApiError(code, body?.error?.message ?? res.statusText, body?.error?.details, res.status)
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const requestUserId = useAuthStore.getState().user?.id ?? null
  const requestSessionRevision = getAuthSessionRevision()
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
    if (res.status === 401) handleUnauthorized(path, requestSessionRevision)
    throw await parseError(res)
  }
  const body = await res.json() as T & { undo?: { token: string; expiresAt?: number; generation?: number } }
  if (body && typeof body === 'object' && body.undo && typeof body.undo.token === 'string'
    && requestUserId === (useAuthStore.getState().user?.id ?? null)
    && requestSessionRevision === getAuthSessionRevision()) {
    publishUndoOpportunity({ ...body.undo, queryKeys: undoQueryKeys(path, options?.method ?? 'GET') })
  }
  return body
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { signal })
}

export async function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, signal })
}

export async function apiPostBlob(path: string, body: unknown, signal?: AbortSignal): Promise<Blob> {
  const requestSessionRevision = getAuthSessionRevision()
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path, requestSessionRevision)
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

export async function apiUpload<T>(path: string, file: File | FormData, method: 'POST' | 'PUT' = 'POST', options?: { signal?: AbortSignal; onProgress?: (percent: number) => void }): Promise<T> {
  const requestSessionRevision = getAuthSessionRevision()
  const formData = file instanceof FormData ? file : new FormData()
  if (file instanceof File) formData.append('file', file)
  if (options?.onProgress) {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const abort = () => xhr.abort()
      const finish = () => options.signal?.removeEventListener('abort', abort)
      xhr.open(method, `${BASE_URL}${path}`)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) options.onProgress?.(Math.round(event.loaded / event.total * 100))
      }
      xhr.onload = () => {
        finish()
        let body: { error?: { code?: string; message?: string; details?: unknown } } & T
        try { body = JSON.parse(xhr.responseText) } catch { reject(new ApiError('UNKNOWN', 'Invalid upload response')); return }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body)
        else {
          if (xhr.status === 401) handleUnauthorized(path, requestSessionRevision)
          reject(new ApiError(body.error?.code ?? 'UNKNOWN', body.error?.message ?? xhr.statusText, body.error?.details))
        }
      }
      xhr.onerror = () => { finish(); reject(new ApiError('NETWORK_ERROR', 'Upload connection failed')) }
      xhr.onabort = () => { finish(); reject(new DOMException('Upload aborted', 'AbortError')) }
      if (options.signal?.aborted) { reject(new DOMException('Upload aborted', 'AbortError')); return }
      options.signal?.addEventListener('abort', abort, { once: true })
      xhr.send(formData)
    })
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    body: formData,
    signal: options?.signal,
  })
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path, requestSessionRevision)
    throw await parseError(res)
  }
  return res.json() as Promise<T>
}

export interface AiStreamHandlers {
  onAccepted?: (event: { id: string; threadId: string | null }) => void
  onMeta?: (event: { requestId: string; runId?: string; threadId?: string; model?: string; receipt: AiContextReceipt }) => void
  onDelta?: (text: string) => void
  onUsage?: (event: { inputTokens?: number; outputTokens?: number }) => void
  onTool?: (event: { name: string; phase: 'start' | 'result'; chapterIndex?: number; resultChars?: number; citations?: AiCitation[] }) => void
  onDone?: (event: { content: string; citations: AiCitation[] }) => void
}

interface AiChatJobContext {
  clientRequestId: string
  scopeKey?: string
  threadId?: string
}

async function observeAiJob(body: AiChatJobCreateReq, handlers: AiStreamHandlers, signal?: AbortSignal): Promise<void> {
  const revision = getAuthSessionRevision()
  const controller = new AbortController()
  const unsubscribe = useAuthStore.subscribe(() => { if (getAuthSessionRevision() !== revision) controller.abort() })
  const observationSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  try {
    let job = (await apiPost<{ data: AiChatJobRes }>('/ai/jobs', body, observationSignal)).data
    observationSignal.throwIfAborted()
    handlers.onAccepted?.({ id: job.id, threadId: job.threadId })
    let content = ''
    let lastTool = ''
    while (true) {
      observationSignal.throwIfAborted()
      if (job.receipt) handlers.onMeta?.({ requestId: job.id, ...(job.runId ? { runId: job.runId } : {}), ...(job.kind === 'book' && job.threadId ? { threadId: job.threadId } : {}), receipt: job.receipt })
      if (job.content.startsWith(content) && job.content.length > content.length) handlers.onDelta?.(job.content.slice(content.length))
      content = job.content
      const tool = JSON.stringify(job.tool)
      if (job.tool && tool !== lastTool) handlers.onTool?.(job.tool)
      lastTool = tool
      if (job.state === 'completed') {
        handlers.onDone?.({ content: job.content, citations: job.citations.map(parseAiCitation).filter((citation): citation is AiCitation => citation !== null) })
        return
      }
      if (job.state === 'cancelled') throw new DOMException('AI generation cancelled', 'AbortError')
      if (job.state !== 'running') throw new ApiError(job.error?.code ?? 'AI_PROVIDER_ERROR', job.error?.message ?? 'AI generation was interrupted')
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); observationSignal.removeEventListener('abort', abort); reject(new DOMException('AI observation detached', 'AbortError')) }
        const timer = setTimeout(() => { observationSignal.removeEventListener('abort', abort); resolve() }, 500)
        observationSignal.addEventListener('abort', abort, { once: true })
        if (observationSignal.aborted) abort()
      })
      job = (await apiGet<{ data: AiChatJobRes }>(`/ai/jobs/${encodeURIComponent(job.id)}`, observationSignal)).data
    }
  } finally {
    unsubscribe()
  }
}

export async function apiStreamAiChat(body: AiChatReq, handlers: AiStreamHandlers, signal?: AbortSignal, context?: AiChatJobContext): Promise<void> {
  return observeAiJob({ kind: 'book', clientRequestId: context?.clientRequestId ?? crypto.randomUUID(), request: body }, handlers, signal)
}

export async function apiStreamAiLocalChat(body: AiLocalChatReq, handlers: AiStreamHandlers, signal?: AbortSignal, context?: AiChatJobContext): Promise<void> {
  if (!context?.scopeKey || !context.threadId) throw new ApiError('VALIDATION_ERROR', 'Local AI job requires a saved conversation')
  return observeAiJob({ kind: 'local', clientRequestId: context.clientRequestId, scopeKey: context.scopeKey, threadId: context.threadId, request: body }, handlers, signal)
}
