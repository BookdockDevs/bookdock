import { existsSync } from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { config } from '../config'
import { AppError } from '../middleware/error'

interface DictionaryJob { mdx: string; mdds: string[]; kind: 'validate' | 'lookup' | 'resource'; candidates?: string[]; key?: string }
interface DictionaryReply { ok?: boolean; error?: boolean; headword?: string | null; html?: string; data?: string | null }
let worker: Worker | null = null
let activePath = ''
let queue = Promise.resolve()
let pending = 0
let idle: ReturnType<typeof setTimeout> | undefined

export function dictionaryDirectory(userId: string, id?: string) {
  if (![userId, ...(id ? [id] : [])].every((value) => /^[a-zA-Z0-9_-]{1,100}$/.test(value))) throw new AppError('DICTIONARY_NOT_FOUND')
  return path.join(config.dataDir, 'dictionaries', userId, ...(id ? [id] : []))
}

export async function releaseDictionaryReader(directory?: string) {
  if (directory && activePath !== directory && !activePath.startsWith(directory + path.sep)) return
  clearTimeout(idle)
  const previous = worker
  worker = null
  activePath = ''
  await previous?.terminate()
}

export async function readDictionary(job: DictionaryJob): Promise<DictionaryReply> {
  if (pending >= 8) throw new AppError('DICTIONARY_BUSY', 'Dictionary is busy')
  pending++
  const previous = queue
  let finish!: () => void
  queue = new Promise<void>((resolve) => { finish = resolve })
  await previous
  clearTimeout(idle)
  try {
    if (activePath !== job.mdx) await releaseDictionaryReader()
    if (!worker) {
      const bundled = new URL('./mdict.worker.mjs', import.meta.url)
      worker = new Worker(existsSync(bundled) ? bundled : new URL('./mdict.worker.bootstrap.mjs', import.meta.url), {
        resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
      })
      worker.on('error', () => {})
      activePath = job.mdx
    }
    const instance = worker
    return await new Promise<DictionaryReply>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); instance.off('message', message); instance.off('error', failure); instance.off('exit', failure) }
      const failure = () => { cleanup(); if (worker === instance) { worker = null; activePath = '' }; reject(new AppError('DICTIONARY_INVALID', 'Dictionary could not be read')) }
      const message = (reply: DictionaryReply) => { cleanup(); if (reply.error) reject(new AppError('DICTIONARY_INVALID', 'Dictionary could not be read')); else resolve(reply) }
      const timer = setTimeout(() => { cleanup(); void releaseDictionaryReader(); reject(new AppError('DICTIONARY_INVALID', 'Dictionary parsing timed out')) }, 20_000)
      instance.once('message', message)
      instance.once('error', failure)
      instance.once('exit', failure)
      instance.postMessage(job)
    })
  } finally {
    pending--
    finish()
    idle = setTimeout(() => { void releaseDictionaryReader() }, 60_000)
    idle.unref()
    worker?.unref()
  }
}
