// Reader content is account- and session-scoped. A detached epoch lets every
// in-flight manifest/entry response detect that it is no longer current before
// it can write a cache entry or be consumed by a new viewer.

const GUEST_SCOPE_KEY = 'bd-reader-guest-scope'

let accountId: string | null = null
let epoch = 0
const listeners = new Set<() => void>()

function randomScope(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

function readGuestScope(): string {
  try {
    const existing = sessionStorage.getItem(GUEST_SCOPE_KEY)
    if (existing) return existing
    const created = randomScope()
    sessionStorage.setItem(GUEST_SCOPE_KEY, created)
    return created
  } catch {
    return randomScope()
  }
}

let guestScope = readGuestScope()

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // A cache cleanup listener must not break the auth transition.
    }
  }
}

export function getSessionEpoch(): number {
  return epoch
}

export function getContentAccountScope(): string {
  return accountId ? `u:${accountId}` : `g:${guestScope}`
}

/** Returns true when the viewing account actually changed. */
export function setSessionAccount(id: string | null): boolean {
  if (id === accountId) return false
  accountId = id
  epoch += 1
  notify()
  return true
}

/** Logout: the next guest gets a fresh tab-local cache namespace. */
export function resetSessionScope(): void {
  accountId = null
  epoch += 1
  guestScope = randomScope()
  try {
    sessionStorage.setItem(GUEST_SCOPE_KEY, guestScope)
  } catch {
    // A sessionStorage refusal still leaves the in-memory scope fresh.
  }
  notify()
}

/** Permission/role changes invalidate live readers without changing account. */
export function invalidateReaderSession(): void {
  epoch += 1
  notify()
}

export function onSessionScopeChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function assertSessionEpoch(expected: number): void {
  if (epoch !== expected) throw new ReaderSessionChangedError()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== 'bd-user') return
    let nextId: string | null = null
    try {
      const value = event.newValue ? JSON.parse(event.newValue) as { id?: unknown; guest?: unknown; role?: unknown } : null
      if (typeof value?.id === 'string' && value.guest !== true && value.role !== 'guest') nextId = value.id
    } catch {
      nextId = null
    }
    if (nextId === null) resetSessionScope()
    else if (!setSessionAccount(nextId)) invalidateReaderSession()
  })
}

export class ReaderSessionChangedError extends Error {
  constructor() {
    super('Reader session changed')
    this.name = 'ReaderSessionChangedError'
  }
}
