import type { EditorTxtSaveReq } from '@bookdock/shared'

import type { decodeLocalTxt, PreparedLocalTxt } from './prepare-txt'

export type TxtWorkerInput =
  | { operation?: 'prepare'; file: Blob; fileName: string; title: string; contentId: string }
  | { operation: 'edit'; draft: EditorTxtSaveReq; fileName: string; title: string; contentId: string }
  | { operation: 'decode'; file: Blob }

export function prepareTxtInWorker(file: File, title: string, contentId: string, signal: AbortSignal): Promise<PreparedLocalTxt> {
  return runTxtWorker<PreparedLocalTxt>({ file, fileName: file.name, title, contentId }, signal)
}

export function prepareEditedTxtInWorker(draft: EditorTxtSaveReq, fileName: string, title: string, contentId: string, signal: AbortSignal): Promise<PreparedLocalTxt> {
  return runTxtWorker<PreparedLocalTxt>({ operation: 'edit', draft, fileName, title, contentId }, signal)
}

export function decodeTxtInWorker(file: Blob, signal: AbortSignal): Promise<Awaited<ReturnType<typeof decodeLocalTxt>>> {
  return runTxtWorker<Awaited<ReturnType<typeof decodeLocalTxt>>>({ operation: 'decode', file }, signal)
}

function runTxtWorker<T>(input: TxtWorkerInput, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./txt.worker.ts', import.meta.url), { type: 'module' })
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
    const abort = () => finish(new DOMException('TXT preparation cancelled', 'AbortError'))
    const timeout = setTimeout(() => finish(new Error('TXT preparation timed out')), 90_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => finish(new Error(event.message || 'TXT worker failed'))
    worker.onmessage = (event: MessageEvent<{ result?: T; error?: string }>) => {
      if (event.data.error || !event.data.result) finish(new Error(event.data.error ?? 'Invalid TXT preparation result'))
      else finish(undefined, event.data.result)
    }
    if (signal.aborted) { abort(); return }
    try { worker.postMessage(input) } catch (error) { finish(error instanceof Error ? error : new Error('TXT worker failed')) }
  })
}
