import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import type { QuickJSDeferredPromise } from 'quickjs-emscripten'

import { personalMetadataCandidateSchema, personalMetadataFieldsSchema } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import type { PersonalSourceFetchInit, PersonalSourceFetchResult } from './personal-source-fetch'

// CPU is bounded per execution slice (between two await points), so network
// waits do not consume the budget. WALL_LIMIT_MS governs overall progress and
// is enforced unconditionally: at teardown any still-unsettled fetch promise
// is rejected in the sandbox before disposal, so JS_FreeRuntime never sees a
// pending promise and late host callbacks are guarded by `disposed`.
const CPU_LIMIT_MS = 2_000
const WALL_LIMIT_MS = 15_000
const MAX_FETCHES = 20

export interface PersonalSourceRunOptions {
  fetch?: (url: string, init: PersonalSourceFetchInit) => Promise<PersonalSourceFetchResult>
}

// Install-time capability probe. It applies the exact check the runtime makes
// when a detail request arrives, so the stored flag cannot drift from what a
// detail call would actually do.
export async function personalSourceHasDetail(source: string): Promise<boolean> {
  const quickjs = await getQuickJS()
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(16 * 1024 * 1024)
  runtime.setMaxStackSize(512 * 1024)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 2_000))
  const context = runtime.newContext()
  try {
    const evaluated = context.evalCode(source, 'source.js', { type: 'module' })
    if (evaluated.error) {
      evaluated.error.dispose()
      return false
    }
    const exports = evaluated.value
    const provider = context.getProp(exports, 'default')
    exports.dispose()
    try {
      const kind = context.typeof(provider)
      if (kind !== 'object' && kind !== 'function') return false
      const fn = context.getProp(provider, 'getDetail')
      try { return context.typeof(fn) === 'function' } finally { fn.dispose() }
    } finally { provider.dispose() }
  } finally {
    context.dispose()
    runtime.dispose()
  }
}

export async function runPersonalSource(source: string, operation: 'search' | 'getDetail', argument: string, options: PersonalSourceRunOptions = {}): Promise<unknown> {
  const quickjs = await getQuickJS()
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(16 * 1024 * 1024)
  runtime.setMaxStackSize(512 * 1024)
  // Per-slice CPU budget: the interrupt handler measures the length of the
  // current execution slice; await points (network waits) reset the baseline.
  let cpuSliceStart: number | null = null
  const beginCpuSlice = () => { cpuSliceStart = null }
  runtime.setInterruptHandler(() => {
    const now = Date.now()
    if (cpuSliceStart === null) {
      cpuSliceStart = now
      return false
    }
    return now - cpuSliceStart > CPU_LIMIT_MS
  })
  const context = runtime.newContext()
  const wallDeadline = Date.now() + WALL_LIMIT_MS
  let disposed = false
  const pendingFetchPromises = new Set<QuickJSDeferredPromise>()
  try {
    let inFlightFetches = 0
    let fetchCount = 0
    const drainJobs = () => {
      beginCpuSlice()
      const jobs = runtime.executePendingJobs()
      if (jobs.error) {
        jobs.error.dispose()
        return
      }
    }

    if (options.fetch) {
      const userFetch = options.fetch
      const boundedFetch = (url: string, init: PersonalSourceFetchInit): Promise<PersonalSourceFetchResult> => {
        if (disposed || Date.now() > wallDeadline || fetchCount >= MAX_FETCHES) {
          return Promise.reject(new AppError('VALIDATION_ERROR', 'Metadata source fetch budget exhausted'))
        }
        fetchCount++
        inFlightFetches++
        return userFetch(url, init).finally(() => { inFlightFetches-- })
      }
      const fetchFn = context.newFunction('fetch', (urlHandle, initHandle) => {
        const url = urlHandle ? context.getString(urlHandle) : ''
        const init: PersonalSourceFetchInit = {}
        if (initHandle && context.typeof(initHandle) === 'object') {
          try {
            const dumped = context.dump(initHandle) as { method?: unknown; headers?: unknown; body?: unknown } | null
            if (dumped && typeof dumped === 'object') {
              if (typeof dumped.method === 'string') init.method = dumped.method
              if (typeof dumped.body === 'string') init.body = dumped.body.slice(0, 1024 * 1024)
              if (dumped.headers && typeof dumped.headers === 'object') {
                init.headers = {}
                for (const [name, value] of Object.entries(dumped.headers as Record<string, unknown>)) {
                  if (typeof value === 'string') init.headers[name] = value
                }
              }
            }
          } catch { /* A malformed init object is treated as absent. */ }
        }
        const promise = context.newPromise()
        pendingFetchPromises.add(promise)
        void boundedFetch(url, init).then(
          (result) => {
            if (disposed) return
            try {
              const response = context.newObject()
              const status = context.newNumber(result.status)
              context.setProp(response, 'status', status)
              status.dispose()
              const body = context.newString(result.body)
              context.setProp(response, 'body', body)
              body.dispose()
              promise.resolve(response)
              response.dispose()
              promise.dispose()
              pendingFetchPromises.delete(promise)
              drainJobs()
            } catch { /* The sandbox is already torn down; nothing observes this. */ }
          },
          (error: unknown) => {
            if (disposed) return
            try {
              const message = context.newString(error instanceof AppError ? error.message : 'fetch failed')
              promise.reject(message)
              message.dispose()
              promise.dispose()
              pendingFetchPromises.delete(promise)
              drainJobs()
            } catch { /* The sandbox is already torn down; nothing observes this. */ }
          },
        )
        return promise.handle
      })
      context.setProp(context.global, 'fetch', fetchFn)
      fetchFn.dispose()
    }

    const evaluated = context.evalCode(source, 'source.js', { type: 'module' })
    if (evaluated.error) {
      evaluated.error.dispose()
      throw new AppError('VALIDATION_ERROR', 'Metadata source could not be loaded')
    }
    const exports = evaluated.value
    const provider = context.getProp(exports, 'default')
    exports.dispose()
    const fn = context.getProp(provider, operation)
    const input = context.newString(argument)
    const contextObject = context.newObject()
    try {
      if (context.typeof(fn) !== 'function') {
        if (operation === 'getDetail') return null
        throw new AppError('VALIDATION_ERROR', 'Metadata source does not implement search')
      }
      beginCpuSlice()
      const result = context.callFunction(fn, provider, input, contextObject)
      if (result.error) {
        result.error.dispose()
        throw new AppError('VALIDATION_ERROR', 'Metadata source failed')
      }
      try {
        let state = context.getPromiseState(result.value)
        while (state.type === 'pending') {
          if (Date.now() > wallDeadline) throw new AppError('VALIDATION_ERROR', 'Metadata source did not complete in time')
          if (inFlightFetches === 0) throw new AppError('VALIDATION_ERROR', 'Metadata source did not complete')
          await new Promise((resolve) => setImmediate(resolve))
          drainJobs()
          state = context.getPromiseState(result.value)
        }
        if (state.type === 'rejected') {
          state.error.dispose()
          throw new AppError('VALIDATION_ERROR', 'Metadata source failed')
        }
        try {
          const value: unknown = context.dump(state.value)
          const parsed = operation === 'search'
            ? personalMetadataCandidateSchema.array().max(100).safeParse(value)
            : personalMetadataFieldsSchema.safeParse(value)
          if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid metadata source result')
          return parsed.data
        } finally { if (!state.notAPromise) state.value.dispose() }
      } finally { result.value.dispose() }
    } finally {
      contextObject.dispose()
      input.dispose()
      fn.dispose()
      provider.dispose()
    }
  } finally {
    // Settle every fetch promise still pending in the sandbox before disposal:
    // JS_FreeRuntime aborts the process if promises are left pending. The real
    // host fetches keep running; their late callbacks hit the disposed guard.
    for (const promise of pendingFetchPromises) {
      try {
        const message = context.newString('fetch aborted')
        promise.reject(message)
        message.dispose()
        promise.dispose()
      } catch { /* Already settled or disposed. */ }
    }
    pendingFetchPromises.clear()
    disposed = true
    context.dispose()
    runtime.dispose()
  }
}
