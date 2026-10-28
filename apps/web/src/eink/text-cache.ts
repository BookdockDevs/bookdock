const MAX_ITEMS = 5
const MAX_BYTES = 4 * 1024 * 1024

export function createTextCache() {
  const entries = new Map<string, string>()
  let bytes = 0
  return {
    get(key: string) {
      const value = entries.get(key)
      if (value !== undefined) {
        entries.delete(key)
        entries.set(key, value)
      }
      return value
    },
    set(key: string, value: string) {
      const previous = entries.get(key)
      if (previous !== undefined) bytes -= previous.length * 2
      entries.delete(key)
      const size = value.length * 2
      if (size > MAX_BYTES) return
      entries.set(key, value)
      bytes += size
      while (entries.size > MAX_ITEMS || bytes > MAX_BYTES) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        bytes -= entries.get(oldest)!.length * 2
        entries.delete(oldest)
      }
    },
  }
}
