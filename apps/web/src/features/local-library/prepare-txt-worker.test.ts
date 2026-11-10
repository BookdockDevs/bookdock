import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreparedLocalTxt } from './prepare-txt'
import { decodeTxtInWorker, prepareEditedTxtInWorker, prepareTxtInWorker } from './prepare-txt-worker'

class WorkerStub {
  static instances: WorkerStub[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { WorkerStub.instances.push(this) }
}

beforeEach(() => { vi.useFakeTimers(); WorkerStub.instances = []; vi.stubGlobal('Worker', WorkerStub) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('bounded local TXT worker lifetime', () => {
  it('uses the same bounded worker lifecycle for local editor decoding and rebuilds', async () => {
    const controller = new AbortController()
    const file = new File(['text'], 'Book.txt')
    const decoded = decodeTxtInWorker(file, controller.signal)
    const first = WorkerStub.instances[0]!
    expect(first.postMessage).toHaveBeenCalledWith({ operation: 'decode', file })
    first.onmessage!({ data: { result: { text: 'Decoded', encoding: 'UTF-8' } } })
    await expect(decoded).resolves.toEqual({ text: 'Decoded', encoding: 'UTF-8' })
    expect(first.terminate).toHaveBeenCalledOnce()
    const draft = { baseRevisionId: 'before', chapters: [{ id: 'one', title: '', content: 'Edited', level: 0 }] }
    const rebuilt = prepareEditedTxtInWorker(draft, file.name, 'Book', 'after', controller.signal)
    const second = WorkerStub.instances[1]!
    expect(second.postMessage).toHaveBeenCalledWith({ operation: 'edit', draft, fileName: file.name, title: 'Book', contentId: 'after' })
    const rejection = expect(rebuilt).rejects.toHaveProperty('name', 'AbortError')
    controller.abort()
    await rejection
    expect(second.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('releases the worker and ignores duplicate completion after returning the result', async () => {
    const file = new File(['text'], 'Book.txt')
    const pending = prepareTxtInWorker(file, 'Book', 'content', new AbortController().signal)
    const worker = WorkerStub.instances[0]!
    expect(worker.postMessage).toHaveBeenCalledWith({ file, fileName: file.name, title: 'Book', contentId: 'content' })
    const result = { publication: new Blob(['publication']) } as PreparedLocalTxt
    const complete = worker.onmessage!
    complete({ data: { result } })
    complete({ data: { error: 'Late failure' } })
    expect(await pending).toBe(result)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.onmessage).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start cancelled work and terminates an active worker immediately on cancellation', async () => {
    const cancelled = new AbortController()
    cancelled.abort()
    expect(() => prepareTxtInWorker(new File(['text'], 'Book.txt'), 'Book', 'content', cancelled.signal)).toThrow()
    expect(WorkerStub.instances).toEqual([])
    const controller = new AbortController()
    const pending = prepareTxtInWorker(new File(['text'], 'Book.txt'), 'Book', 'content', controller.signal)
    const rejection = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    controller.abort()
    await rejection
    expect(WorkerStub.instances[0]!.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds a stalled worker and releases it after worker errors', async () => {
    const pending = prepareTxtInWorker(new File(['text'], 'Book.txt'), 'Book', 'content', new AbortController().signal)
    const rejection = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(90_000)
    await rejection
    expect(WorkerStub.instances[0]!.terminate).toHaveBeenCalledOnce()
    const failed = prepareTxtInWorker(new File(['text'], 'Book.txt'), 'Book', 'content', new AbortController().signal)
    const failure = expect(failed).rejects.toThrow('Worker execution failed')
    WorkerStub.instances[1]!.onerror!({ message: 'Worker execution failed' })
    await failure
    expect(WorkerStub.instances[1]!.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
