import { afterEach, describe, expect, it, vi } from 'vitest'

interface FakeRecord {
  key: string
  bytes?: number
  data?: ArrayBuffer
}

function createIndexedDb(quotaBytes = Number.POSITIVE_INFINITY, initiallyExisting = false, blocked = false) {
  const stores = new Map<string, Map<string, FakeRecord>>()
  if (initiallyExisting) {
    stores.set('text', new Map([['legacy|chapter.xhtml', {
      key: 'legacy|chapter.xhtml', ns: 'legacy', text: 'old cache', bytes: 18, savedAt: 1, lastReadAt: 2,
    }]]))
    stores.set('blob', new Map([['legacy|cover.png', {
      key: 'legacy|cover.png', ns: 'legacy', data: new ArrayBuffer(4), mediaType: 'image/png', bytes: 4, savedAt: 1, lastReadAt: 1,
    }]]))
  }
  let budgetScans = 0
  let openCalls = 0
  let pauseBudgetScan = false
  let continueBudgetScan: (() => void) | null = null
  let reportBudgetScanPaused: (() => void) | null = null
  const storeBytes = () => [...stores.values()].flatMap((store) => [...store.values()])
    .reduce((sum, record) => sum + (record.bytes ?? record.data?.byteLength ?? 0), 0)

  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore(name: string) {
      stores.set(name, new Map())
      return { createIndex() {} }
    },
    transaction(names: string | string[]) {
      const transaction: Record<string, any> = { error: null }
      const selected = Array.isArray(names) ? names : [names]
      let failed = false
      const finish = () => queueMicrotask(() => {
        if (failed) transaction.onabort?.()
        else transaction.oncomplete?.()
      })
      transaction.objectStore = (name: string) => {
        if (!selected.includes(name)) throw new Error('store not in transaction')
        const store = stores.get(name)!
        return {
          get: (key: string) => {
            const request: Record<string, any> = { result: store.get(key) }
            queueMicrotask(() => request.onsuccess?.())
            finish()
            return request
          },
          getAll: () => {
            if (name !== 'reader-meta') throw new Error('content payload store was scanned')
            const request: Record<string, any> = { result: [...store.values()] }
            finish()
            return request
          },
          openCursor: () => {
            if (name === 'reader-meta') budgetScans += 1
            const request: Record<string, any> = {}
            const rows = [...store.entries()]
            let index = 0
            const advance = () => queueMicrotask(() => {
              if (name === 'reader-meta' && pauseBudgetScan) {
                pauseBudgetScan = false
                continueBudgetScan = advance
                reportBudgetScanPaused?.()
                return
              }
              if (index >= rows.length) {
                request.result = null
                request.onsuccess?.()
                finish()
                return
              }
              const [key, value] = rows[index++]!
              request.result = {
                value,
                delete: () => store.delete(key),
                continue: advance,
              }
              request.onsuccess?.()
            })
            advance()
            return request
          },
          put: (record: FakeRecord) => {
            const previous = store.get(record.key)
            const nextBytes = storeBytes() - (previous?.bytes ?? previous?.data?.byteLength ?? 0)
              + (record.bytes ?? record.data?.byteLength ?? 0)
            if (nextBytes > quotaBytes) {
              failed = true
              transaction.error = new DOMException('Quota exceeded', 'QuotaExceededError')
            } else store.set(record.key, record)
            finish()
          },
          delete: (key: string) => { store.delete(key); finish() },
          clear: () => { store.clear(); finish() },
        }
      }
      return transaction
    },
  }

  const indexedDB = {
    open() {
      openCalls += 1
      const request: Record<string, any> = { result: db }
      queueMicrotask(() => {
        if (blocked) {
          request.onblocked?.()
          return
        }
        request.transaction = { objectStore: (name: string) => db.transaction(name).objectStore(name) }
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
  return {
    indexedDB,
    getBudgetScans: () => budgetScans,
    getOpenCalls: () => openCalls,
    pauseNextBudgetScan: () => {
      pauseBudgetScan = true
      return new Promise<void>((resolve) => { reportBudgetScanPaused = resolve })
    },
    releaseBudgetScan: () => {
      const resume = continueBudgetScan
      continueBudgetScan = null
      resume?.()
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.useRealTimers()
})

describe('reader IndexedDB stores', () => {
  it('evicts least recently read entries across text and media stores', async () => {
    const fake = createIndexedDb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const { idbChapterTextStore, idbReaderBlobStore } = await import('../idb-chapter-store')

    await idbChapterTextStore.put('account|book|rev|old.xhtml', 'ab')
    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
    await idbReaderBlobStore.put('account|book|rev|image.png', new Uint8Array([1, 2, 3, 4]).buffer, 'image/png')
    await idbChapterTextStore.enforceBudget('ignored-namespace', 4)

    expect(await idbChapterTextStore.get('account|book|rev|old.xhtml')).toBeUndefined()
    expect(await idbReaderBlobStore.get('account|book|rev|image.png')).toMatchObject({ mediaType: 'image/png' })
  })

  it('treats IndexedDB quota refusal as a cache miss without breaking reads', async () => {
    const fake = createIndexedDb(2)
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const { idbChapterTextStore } = await import('../idb-chapter-store')

    await expect(idbChapterTextStore.put('account|book|rev|chapter.xhtml', 'text')).resolves.toBeUndefined()
    expect(await idbChapterTextStore.get('account|book|rev|chapter.xhtml')).toBeUndefined()
    expect(fake.getOpenCalls()).toBe(1)
  })

  it('degrades to online cache misses when opening the upgraded database is blocked', async () => {
    const fake = createIndexedDb(Number.POSITIVE_INFINITY, false, true)
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const { idbChapterTextStore } = await import('../idb-chapter-store')

    await expect(idbChapterTextStore.put('account|book|rev|chapter.xhtml', 'text')).resolves.toBeUndefined()
    expect(await idbChapterTextStore.get('account|book|rev|chapter.xhtml')).toBeUndefined()
    expect(fake.getOpenCalls()).toBe(1)
  })

  it('migrates old records with a cursor and never reads all text or binary payloads for budget checks', async () => {
    const fake = createIndexedDb(Number.POSITIVE_INFINITY, true)
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const { idbChapterTextStore, idbReaderBlobStore } = await import('../idb-chapter-store')

    expect(await idbChapterTextStore.get('legacy|chapter.xhtml')).toMatchObject({ text: 'old cache' })
    expect(await idbReaderBlobStore.get('legacy|cover.png')).toMatchObject({ mediaType: 'image/png' })
    await idbChapterTextStore.enforceBudget('legacy', 1024)

    expect(fake.getBudgetScans()).toBeGreaterThan(0)
    expect(await idbChapterTextStore.get('legacy|chapter.xhtml')).toMatchObject({ text: 'old cache' })
  })

  it('coalesces repeated same-tab budget checks', async () => {
    const fake = createIndexedDb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const { idbChapterTextStore } = await import('../idb-chapter-store')

    await idbChapterTextStore.put('a|one.xhtml', 'one')
    await Promise.all(Array.from({ length: 12 }, () => idbChapterTextStore.enforceBudget('a', 1024)))

    expect(fake.getBudgetScans()).toBe(1)
  })

  it('rechecks the budget when a same-tab write lands during an active eviction scan', async () => {
    const fake = createIndexedDb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const { idbChapterTextStore } = await import('../idb-chapter-store')
    const scanPaused = fake.pauseNextBudgetScan()

    const enforcing = idbChapterTextStore.enforceBudget('x', 0)
    await scanPaused
    await idbChapterTextStore.put('x|late.xhtml', 'late write')
    fake.releaseBudgetScan()
    await enforcing

    expect(await idbChapterTextStore.get('x|late.xhtml')).toBeUndefined()
    expect(fake.getBudgetScans()).toBe(2)
  })
})
