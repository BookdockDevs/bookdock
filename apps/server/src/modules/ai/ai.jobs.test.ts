import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiChatJobCreateReq } from '@bookdock/shared'

import { createTestDbWithShelves } from '../../__tests__/setup'
import { getDb } from '../../db/client'
import { aiChatJobs, users } from '../../db/schema'
import { acknowledgeAiChatJob, cancelAiChatJob, createAiChatJob, getAiChatJob, interruptStaleAiChatJobs, listAiChatJobs } from './ai.jobs.service'
import { createAiChatStream, createAiLocalChatStream } from './ai.service'
import { getActiveBook } from '../books/books.service'

vi.mock('../../db/client', () => ({ getDb: vi.fn() }))
vi.mock('./ai.service', () => ({ createAiChatStream: vi.fn(), createAiLocalChatStream: vi.fn(), cancelAiChatRun: vi.fn() }))
vi.mock('./ai.sessions.service', () => ({ createAiThread: vi.fn(() => ({ id: 'thread-1' })), getAiThread: vi.fn(() => ({ id: 'thread-1' })) }))
vi.mock('../books/books.service', () => ({ getActiveBook: vi.fn().mockResolvedValue({ id: 'book-1' }) }))

const input: AiChatJobCreateReq = {
  kind: 'local', clientRequestId: 'assistant-1', scopeKey: 'local:vault:book-1:revision-1', threadId: 'local-thread-1',
  request: { prompt: 'Explain this selection.', context: { selection: 'Source text', cfiRange: 'selection' } },
}

function pendingStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
  return {
    stream,
    emit(event: string, value: unknown) { controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)) },
    close() { controller.close() },
  }
}

describe('AI background jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const db = createTestDbWithShelves()
    vi.mocked(getDb).mockReturnValue(db as never)
    db.insert(users).values([{ id: 'user-1', username: 'one', createdAt: 1 }, { id: 'user-2', username: 'two', createdAt: 1 }]).run()
    vi.mocked(getActiveBook).mockResolvedValue({ id: 'book-1' } as never)
  })

  it('accepts before provider headers and completes without any observer', async () => {
    const upstream = pendingStream()
    let respond!: (value: never) => void
    vi.mocked(createAiLocalChatStream).mockImplementationOnce(() => new Promise((resolve) => { respond = resolve }))
    const job = await createAiChatJob('user-1', 'member', input)
    expect(job.state).toBe('running')
    expect((await createAiChatJob('user-1', 'member', input)).id).toBe(job.id)
    expect(createAiLocalChatStream).toHaveBeenCalledTimes(1)
    expect(() => getAiChatJob('user-2', job.id)).toThrow('AI job not found')
    expect(await listAiChatJobs('user-2', 'local', input.kind === 'local' ? input.scopeKey : '')).toEqual([])
    respond({ stream: upstream.stream, requestId: 'request-1', receipt: {} } as never)
    upstream.emit('meta', { receipt: { selectionChars: 11, contextChars: 11 } })
    upstream.emit('delta', { text: 'Background ' })
    upstream.emit('done', { content: 'Background answer.', citations: [] })
    upstream.close()
    await vi.waitFor(() => expect(getAiChatJob('user-1', job.id)).toMatchObject({ state: 'completed', content: 'Background answer.' }))
    acknowledgeAiChatJob('user-1', job.id)
    expect(getAiChatJob('user-1', job.id).state).toBe('completed')
    expect(await listAiChatJobs('user-1', 'local', job.scopeKey)).toEqual([])
  })

  it('preserves explicit cancellation and limits account concurrency', async () => {
    vi.mocked(createAiLocalChatStream).mockImplementationOnce((_user, _role, _request, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })
    }))
    const job = await createAiChatJob('user-1', 'member', input)
    await expect(createAiChatJob('user-1', 'member', { ...input, clientRequestId: 'another' })).rejects.toMatchObject({ code: 'AI_BUSY' })
    expect(() => acknowledgeAiChatJob('user-1', job.id)).toThrow('AI job is still running')
    expect(() => cancelAiChatJob('user-2', job.id)).toThrow('AI job not found')
    expect(cancelAiChatJob('user-1', job.id).state).toBe('cancelled')
    await vi.waitFor(() => expect(getAiChatJob('user-1', job.id).state).toBe('cancelled'))
  })

  it('stores provider diagnostics and interrupted jobs without automatically retrying', async () => {
    const upstream = pendingStream()
    vi.mocked(createAiLocalChatStream).mockResolvedValueOnce({ stream: upstream.stream } as never)
    const job = await createAiChatJob('user-1', 'member', input)
    upstream.emit('error', { code: 'AI_TIMEOUT', message: 'Provider timed out' })
    upstream.close()
    await vi.waitFor(() => expect(getAiChatJob('user-1', job.id)).toMatchObject({ state: 'failed', error: { code: 'AI_TIMEOUT', message: 'Provider timed out' } }))
    const row = getDb().select().from(aiChatJobs).get()!
    getDb().insert(aiChatJobs).values({ ...row, id: 'restart-job', clientRequestId: 'restart', state: 'running', snapshot: { ...row.snapshot, id: 'restart-job', state: 'running' } }).run()
    expect(interruptStaleAiChatJobs()).toBe(1)
    expect(getAiChatJob('user-1', 'restart-job')).toMatchObject({ state: 'interrupted', error: { code: 'AI_PROVIDER_ERROR' } })
    expect(createAiLocalChatStream).toHaveBeenCalledTimes(1)
  })

  it('keeps server-book generation on a detached job signal and enforces read access', async () => {
    const upstream = pendingStream()
    vi.mocked(createAiChatStream).mockResolvedValueOnce({ stream: upstream.stream, runId: 'run-1' } as never)
    const job = await createAiChatJob('user-1', 'member', {
      kind: 'book', clientRequestId: 'book-answer', request: { bookId: 'book-1', prompt: 'Question', context: input.request.context },
    })
    expect(job.threadId).toBe('thread-1')
    const signal = vi.mocked(createAiChatStream).mock.calls[0]![3]
    expect(signal.aborted).toBe(false)
    upstream.emit('done', { content: 'Server book answer', citations: [] })
    upstream.close()
    await vi.waitFor(() => expect(getAiChatJob('user-1', job.id).state).toBe('completed'))
    vi.mocked(getActiveBook).mockRejectedValueOnce(new Error('No read access'))
    await expect(listAiChatJobs('user-1', 'book', 'book-1')).rejects.toThrow('No read access')
  })
})
