const MAX_BYTES = 4 * 1024 * 1024
const MAX_ITEM_BYTES = 2 * 1024 * 1024

export function createImageCache() {
  const entries = new Map<string, Blob>()
  let bytes = 0
  return {
    get(key: string) {
      const value = entries.get(key)
      if (value) { entries.delete(key); entries.set(key, value) }
      return value
    },
    set(key: string, value: Blob) {
      if (value.size > MAX_ITEM_BYTES) return
      const previous = entries.get(key)
      if (previous) bytes -= previous.size
      entries.delete(key)
      entries.set(key, value)
      bytes += value.size
      while (bytes > MAX_BYTES || entries.size > 16) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        bytes -= entries.get(oldest)!.size
        entries.delete(oldest)
      }
    },
  }
}
