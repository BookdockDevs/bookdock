import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JOB_LIFETIME_MS, LEASE_MS, TRANSFER_TIMEOUT_MS, canRetry } from './model'
import type { Connection } from './model'
import { appendChunk, claimJob, completeJob, createJob, createJobs, disconnect, failJob, finishTransfer, getJob, listJobs, queueBatch, removeBatch, removeJob, renewLease, saveConnection, sweepJobs } from './store'

const connection: Connection = { id: 'connection-1', baseUrl: 'https://books.example.com', token: 'bd_test', userId: 'user_1', username: 'reader', uploadMaxBytes: 1024 * 1024, enabled: true }
const bytes = new TextEncoder().encode('test')

describe('temporary upload lifecycle', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    await disconnect()
    await saveConnection(connection)
  })

  async function ready() {
    const job = await createJob(connection, 'book.txt', bytes.length, 1, 2)
    await appendChunk(job.id, 0, bytes, { tabId: 1, frameId: 2 })
    await finishTransfer(job.id, { tabId: 1, frameId: 2 })
    return job
  }

  it('keeps sequence, size, and sender checks atomic without advancing a rejected chunk', async () => {
    const job = await createJob(connection, 'book.txt', bytes.length, 1, 2)
    // Every protocol misuse now surfaces as one message, so assert the rejection and the
    // unchanged state rather than the wording: the wording is deliberately not per-check.
    await expect(appendChunk(job.id, 0, bytes, { tabId: 2, frameId: 2 })).rejects.toThrow()
    await expect(appendChunk(job.id, 1, bytes, { tabId: 1, frameId: 2 })).rejects.toThrow()
    await expect(finishTransfer(job.id, { tabId: 1, frameId: 2 })).rejects.toThrow('文件已失效')
    expect((await getJob(job.id))?.received).toBe(0)
    await appendChunk(job.id, 0, bytes, { tabId: 1, frameId: 2 })
    await expect(appendChunk(job.id, 0, bytes, { tabId: 1, frameId: 2 })).rejects.toThrow()
    await finishTransfer(job.id, { tabId: 1, frameId: 2 })
    const claimed = await claimJob(job.id, 'lease-1')
    expect(await claimed.file.text()).toBe('test')
  })

  it('allows one uploader lease and preserves bytes after a recoverable failure', async () => {
    const job = await ready()
    await claimJob(job.id, 'lease-1')
    await expect(claimJob(job.id, 'lease-2')).rejects.toThrow()
    await failJob(job.id, 'wrong-lease', 'wrong')
    expect((await getJob(job.id))?.state).toBe('uploading')
    await failJob(job.id, 'lease-1', 'network error')
    expect(await (await claimJob(job.id, 'lease-2')).file.text()).toBe('test')
    await removeJob(job.id)
    expect(await listJobs()).toEqual([])
    await expect(claimJob(job.id, 'lease-3')).rejects.toThrow()
  })

  it('never uploads a pending file to a replacement connection', async () => {
    const job = await ready()
    await saveConnection({ ...connection, id: 'other', userId: 'user_2' })
    await expect(claimJob(job.id, 'lease')).rejects.toThrow('连接已变更')
    expect(await renewLease(job.id, 'lease')).toBe(false)
  })

  it('cleans abandoned transfers and expires recoverable files without losing a live lease', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const receiving = await createJob(connection, 'partial.txt', 4, 4)
    const complete = await ready()
    await claimJob(complete.id, 'lease')
    vi.setSystemTime(Date.now() + LEASE_MS + 1)
    await sweepJobs()
    expect((await getJob(complete.id))?.state).toBe('failed')
    await claimJob(complete.id, 'next-lease')
    expect(await renewLease(complete.id, 'next-lease')).toBe(true)
    vi.setSystemTime(Date.now() + TRANSFER_TIMEOUT_MS + 1)
    await sweepJobs()
    expect((await getJob(receiving.id))?.state).toBe('failed')
    expect(await getJob(complete.id)).toBeDefined()
    vi.setSystemTime(Date.now() + JOB_LIFETIME_MS + 1)
    await sweepJobs()
    expect(await listJobs()).toEqual([])
  })

  it('removes partial files when their source tab closes and clears everything on disconnect', async () => {
    const job = await createJob(connection, 'book.txt', bytes.length, 7)
    await appendChunk(job.id, 0, bytes, { tabId: 7, frameId: 0 })
    await sweepJobs(7)
    expect((await getJob(job.id))?.state).toBe('failed')
    await ready()
    await disconnect()
    expect(await listJobs()).toEqual([])
  })

  it('counts only live batches against the four-batch ceiling', async () => {
    // Finished batches linger for 24h so the popup can still list them. Counting those against
    // the ceiling turned the fifth drop of a day into "try again", which never worked.
    for (let index = 0; index < 5; index += 1) {
      const [job] = await createJobs(connection, [{ name: `done-${index}.txt`, size: 4 }], { sourceTabId: null })
      await appendChunk(job!.id, 0, bytes)
      await finishTransfer(job!.id)
      await claimJob(job!.id, `lease-${index}`)
      await completeJob(job!.id, `lease-${index}`, { bookVersionId: `book_${index}`, title: `Book ${index}`, author: '', sourceFormat: 'txt', size: 4, duplicated: false })
    }
    for (let index = 0; index < 4; index += 1) await createJobs(connection, [{ name: `live-${index}.txt`, size: 4 }], { sourceTabId: null })
    await expect(createJobs(connection, [{ name: 'blocked.txt', size: 4 }], { sourceTabId: null })).rejects.toThrow('太多')
  })

  it('stages picker files together and retries only failed rows while preserving successful results', async () => {
    const jobs = await createJobs(connection, [{ name: 'one.txt', size: 4 }, { name: 'two.txt', size: 4 }, { name: 'three.txt', size: 4 }], { sourceTabId: null, autoStart: false })
    for (const job of jobs) { await appendChunk(job.id, 0, bytes); await finishTransfer(job.id) }
    expect((await listJobs()).every((job) => job.state === 'pending')).toBe(true)
    await queueBatch(jobs[0].batchId)
    await claimJob(jobs[0].id, 'success')
    await completeJob(jobs[0].id, 'success', { bookVersionId: 'book_1', title: 'One', author: '', sourceFormat: 'txt', size: 4, duplicated: false })
    await claimJob(jobs[1].id, 'failed')
    await failJob(jobs[1].id, 'failed', 'network error')
    await claimJob(jobs[2].id, 'duplicate')
    await completeJob(jobs[2].id, 'duplicate', { bookVersionId: 'book_3', title: 'Three', author: '', sourceFormat: 'txt', size: 4, duplicated: true })
    await queueBatch(jobs[0].batchId, true)
    expect((await getJob(jobs[0].id))?.state).toBe('success')
    expect((await getJob(jobs[1].id))?.state).toBe('ready')
    expect((await getJob(jobs[2].id))?.state).toBe('duplicate')
    await expect(claimJob(jobs[0].id, 'again')).rejects.toThrow()
    expect(await (await claimJob(jobs[1].id, 'retry')).file.text()).toBe('test')
    await removeBatch(jobs[0].batchId)
    expect(await listJobs()).toEqual([])
  })

  it('refuses to requeue a file whose bytes are gone', async () => {
    // The row used to say "文件已失效，请重新添加" and still show 重试. Clicking it set the
    // job to `ready`, woke the uploader, and claimJob rejected it on the same missing
    // chunks microseconds later: identical message, no motion, nothing the reader
    // could have done differently. The transfer is dead because the bytes are dead.
    const [job] = await createJobs(connection, [{ name: 'lost.epub', size: 9 }], { sourceTabId: 7 })
    await appendChunk(job!.id, 0, bytes, { tabId: 7, frameId: 0 })
    await sweepJobs(7)
    const lost = (await getJob(job!.id))!
    expect(lost.state).toBe('failed')
    expect(canRetry(lost)).toBe(false)
    expect(await queueBatch(job!.batchId, true)).toBe(0)
    expect((await getJob(job!.id))?.state).toBe('failed')
  })

  it('keeps a permanent verdict off the retry path even when the bytes survive', async () => {
    const job = await ready()
    await claimJob(job.id, 'lease-1')
    await failJob(job.id, 'lease-1', '文件过大', false)
    expect((await getJob(job.id))?.received).toBe(job.size)
    expect(canRetry((await getJob(job.id))!)).toBe(false)
    expect(await queueBatch(job.batchId, true)).toBe(0)
    expect((await getJob(job.id))?.state).toBe('failed')
  })

  it('does not retry a job pinned to a replaced connection', async () => {
    const job = await ready()
    await claimJob(job.id, 'lease-1')
    await failJob(job.id, 'lease-1', 'network error')
    await saveConnection({ ...connection, id: 'other', userId: 'user_2' })
    expect(await queueBatch(job.batchId, true)).toBe(0)
    expect((await getJob(job.id))?.state).toBe('failed')
  })
})
