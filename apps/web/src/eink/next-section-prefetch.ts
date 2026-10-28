interface Section {
  id: string
  linear?: string
}

export function createNextSectionPrefetch(sections: Section[], loadText: (path: string, signal: AbortSignal) => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let disposed = false

  function cancel() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    controller?.abort()
    controller = null
  }

  function schedule(index: unknown) {
    cancel()
    if (disposed || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= sections.length) return
    const next = sections.slice(index + 1).find(section => section.linear !== 'no')
    if (!next) return
    timer = setTimeout(() => {
      timer = null
      const current = new AbortController()
      controller = current
      void loadText(next.id, current.signal).catch(() => {}).finally(() => {
        if (controller === current) controller = null
      })
    }, 800)
  }

  function dispose() { disposed = true; cancel() }
  return { schedule, cancel, dispose }
}
