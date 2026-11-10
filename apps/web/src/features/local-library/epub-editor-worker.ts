import type { PublicationRelocationSnapshot, PublicationRelocation } from './publication-relocation'
import type { EditorEpubSaveReq } from '@bookdock/shared'

import type { processLocalEpub } from './epub-editor'

export interface EpubWorkerInput { file: Blob; draft?: EditorEpubSaveReq }

export function processEpubInWorker(input: EpubWorkerInput, signal: AbortSignal): Promise<Awaited<ReturnType<typeof processLocalEpub>>> { return runEpubWorker(input, signal) }
export function preparePublicationRelocationInWorker(input: { operation: 'relocate'; source: Blob; target: Blob; snapshot: PublicationRelocationSnapshot; contentId: string }, signal: AbortSignal): Promise<PublicationRelocation> { return runEpubWorker(input, signal) }
export type PublicationWorkerInput = EpubWorkerInput | Parameters<typeof preparePublicationRelocationInWorker>[0]

function runEpubWorker<T>(input: PublicationWorkerInput, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./epub-editor.worker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = (error?: Error, result?: T) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      worker.terminate()
      worker.onmessage = null
      worker.onerror = null
      if (error) reject(error)
      else resolve(result!)
    }
    const abort = () => finish(new DOMException('EPUB preparation cancelled', 'AbortError'))
    const timeout = setTimeout(() => finish(new Error('EPUB preparation timed out')), 90_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => finish(new Error(event.message || 'EPUB worker failed'))
    worker.onmessage = (event: MessageEvent<{ result?: T; error?: string }>) => {
      if (event.data.error || !event.data.result) finish(new Error(event.data.error ?? 'Invalid EPUB preparation result'))
      else finish(undefined, event.data.result)
    }
    if (signal.aborted) { abort(); return }
    try { worker.postMessage(input) } catch (error) { finish(error instanceof Error ? error : new Error('EPUB worker failed')) }
  })
}
