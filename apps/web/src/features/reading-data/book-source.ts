import type { ClientDataScope } from '@bookdock/shared'

/**
 * Where one book's bytes and rows live.
 *
 * The unit here is a book, not a library: a single shelf shows both kinds, and
 * the only thing that differs between two rows is which store answers for that
 * row. So the answer comes from the book's own ref, never from the route, the
 * context, or a filter the reader picked.
 */
export type BookStore = 'device' | 'server'

export type DeviceScope = Extract<ClientDataScope, { kind: 'local' }>

/** Anything that carries a book ref: a full ref, a row, or a projection of one. */
export type BookRefLike = { scope: ClientDataScope } | null | undefined

export function bookStore(ref: BookRefLike): BookStore {
  return ref?.scope.kind === 'local' ? 'device' : 'server'
}

/** Narrows to a device ref, so the vault path never has to re-check the scope. */
export function isDeviceBook<T extends BookRefLike>(ref: T): ref is T & { scope: DeviceScope } {
  return bookStore(ref) === 'device'
}

/** The vault scope a device ref belongs to; null for a server book. */
export function deviceScope(ref: BookRefLike): DeviceScope | null {
  return ref?.scope.kind === 'local' ? ref.scope : null
}

/**
 * Split a mixed selection into the two authorities that answer for it. Every
 * batch action partitions first and then asks each authority for its own half,
 * because one id list can no longer be sent to one endpoint.
 */
export function partitionByStore<T>(
  items: readonly T[],
  refOf: (item: T) => BookRefLike,
): { device: T[]; server: T[] } {
  const device: T[] = []
  const server: T[] = []
  for (const item of items) {
    if (isDeviceBook(refOf(item))) device.push(item)
    else server.push(item)
  }
  return { device, server }
}
