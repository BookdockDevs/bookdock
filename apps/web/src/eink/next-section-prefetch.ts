interface Section {
  id: string
  linear?: string
}

export function createNextSectionPrefetch(sections: Section[], loadText: (path: string, signal: AbortSignal) => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let target: string | null = null
  let pending: Promise<unknown> | null = null
  let disposed = false

  function cancel() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    controller?.abort()
    controller = null
    target = null
    pending = null
  }

  function schedule(index: unknown) {
    if (disposed || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= sections.length) { cancel(); return }
    const next = sections.slice(index + 1).find(section => section.linear !== 'no')
    if (next?.id === target) return
    cancel()
    if (!next) return
    target = next.id
    timer = setTimeout(start, 200)
  }

  function dispose() { disposed = true; cancel() }
  function start() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (!target) return
    const current = new AbortController()
    controller = current
    pending = loadText(target, current.signal).catch(() => null).finally(() => {
      if (controller === current) { controller = null; pending = null; target = null }
    })
  }
  function waitFor(path: string, signal?: AbortSignal) {
    if (target === path && timer !== null) start()
    if (target !== path || controller?.signal === signal || !pending) return null
    if (!signal) return pending
    if (signal.aborted) return Promise.reject(new DOMException('Navigation aborted', 'AbortError'))
    const request = pending
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Navigation aborted', 'AbortError')) }
      signal.addEventListener('abort', abort, { once: true })
      request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }
  return { schedule, cancel, dispose, waitFor }
}
