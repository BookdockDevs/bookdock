interface Section {
  id: string
  linear?: string
  load: (signal?: AbortSignal) => Promise<string | null>
  unload: () => void
}

export function prepareNextSection(sections: Section[], canPrepare: (id: string) => boolean) {
  let active: { section: Section; controller: AbortController; pending: Promise<string | null>; released: boolean } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let target: Section | undefined
  let disposed = false
  const sectionLoads = new WeakMap<Section, Section['load']>()

  function release(item: NonNullable<typeof active>) {
    if (item.released) return
    item.released = true
    item.controller.abort()
    void item.pending.then(url => { if (url) item.section.unload() }, () => {})
  }
  function cancel() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    target = undefined
    if (active) release(active)
    active = null
  }
  for (const section of sections) {
    const load = section.load.bind(section)
    section.load = async signal => {
      const item = active?.section === section ? active : null
      if (item) {
        if (signal?.aborted) throw new DOMException('Navigation aborted', 'AbortError')
        if (signal) {
          await new Promise<void>((resolve, reject) => {
            const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Navigation aborted', 'AbortError')) }
            signal.addEventListener('abort', abort, { once: true })
            item.pending.then(() => resolve(), () => resolve()).finally(() => signal.removeEventListener('abort', abort))
          })
        } else await item.pending.catch(() => null)
        if (signal?.aborted) throw new DOMException('Navigation aborted', 'AbortError')
      }
      try { return await load(signal) }
      finally {
        if (item && active === item) { active = null; target = undefined; release(item) }
      }
    }
    sectionLoads.set(section, load)
  }
  function schedule(index: unknown) {
    if (disposed || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= sections.length) { cancel(); return }
    const next = sections.slice(index + 1).find(section => section.linear !== 'no')
    if (next === target) return
    cancel()
    if (!next || !canPrepare(next.id)) return
    target = next
    timer = setTimeout(() => {
      timer = null
      const controller = new AbortController()
      const pending = sectionLoads.get(next)!(controller.signal)
      active = { section: next, controller, pending, released: false }
      void pending.catch(() => {})
    }, 1000)
  }
  return { schedule, cancel, dispose: () => { disposed = true; cancel() } }
}
