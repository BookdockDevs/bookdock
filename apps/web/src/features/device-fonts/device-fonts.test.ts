import { IDBFactory } from 'fake-indexeddb'
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { deflateSync } from 'node:zlib'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEVICE_FONT_MAX_BYTES, DeviceFontStore, parseDeviceFontNames, sniffFontFormat } from './db'

interface SfntNameRecord { platform: number; language: number; nameId: number; value: string }

function buildSfntTable(records: SfntNameRecord[]): Uint8Array {
  const recs: number[] = []
  const strings: number[] = []
  let relativeOffset = 0
  for (const record of records) {
    const str = new Uint8Array(Buffer.from(record.value, 'utf16le').swap16())
    const rec = new Uint8Array(12)
    const view = new DataView(rec.buffer)
    view.setUint16(0, record.platform)
    view.setUint16(2, 1)
    view.setUint16(4, record.language)
    view.setUint16(6, record.nameId)
    view.setUint16(8, str.length)
    view.setUint16(10, relativeOffset)
    relativeOffset += str.length
    recs.push(...rec)
    strings.push(...str)
  }
  const header6 = new Uint8Array(6)
  const header6View = new DataView(header6.buffer)
  header6View.setUint16(2, records.length)
  header6View.setUint16(4, 6 + records.length * 12)
  return new Uint8Array([...header6, ...recs, ...strings])
}

function buildSfnt(family: string): Uint8Array {
  return buildSfntFromNameTable(buildSfntTable([
    { platform: 3, language: 0x409, nameId: 16, value: family },
  ]))
}

function buildSfntFromNameTable(nameTable: Uint8Array): Uint8Array {
  const header = new Uint8Array(12)
  const headerView = new DataView(header.buffer)
  headerView.setUint32(0, 0x00010000)
  headerView.setUint16(4, 1)
  const tableRec = new Uint8Array(16)
  tableRec.set(Buffer.from('name', 'ascii'), 0)
  const tableRecView = new DataView(tableRec.buffer)
  tableRecView.setUint32(8, 28)
  tableRecView.setUint32(12, nameTable.length)
  return new Uint8Array([...header, ...tableRec, ...nameTable])
}

function buildWoff(nameTable: Uint8Array): Uint8Array {
  const compressed = deflateSync(nameTable)
  const offset = 64
  const container = new Uint8Array(offset + compressed.length)
  const view = new DataView(container.buffer)
  container.set(Buffer.from('wOFF', 'ascii'), 0)
  view.setUint16(12, 1)
  container.set(Buffer.from('name', 'ascii'), 44)
  view.setUint32(48, offset)
  view.setUint32(52, compressed.length)
  view.setUint32(56, nameTable.length)
  container.set(compressed, offset)
  return container
}

function fontFile(bytes: Uint8Array, name = 'test.ttf'): File {
  return new NativeFile([bytes], name) as unknown as File
}

async function freshModules() {
  vi.resetModules()
  return {
    store: await import('./store'),
    urls: await import('./urls'),
  }
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('File', NativeFile)
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('device font storage', () => {
  it('imports a ttf file with the parsed sfnt family and dedupes re-imports by content hash', async () => {
    const store = new DeviceFontStore('dedupe-test')
    const first = await store.import(fontFile(buildSfnt('My Cool Font')))
    expect(first.duplicate).toBe(false)
    expect(first.font.family).toBe('My Cool Font')
    expect(first.font.id).toMatch(/^device-/)
    expect(first.font.format).toBe('ttf')
    expect(first.font.fileName).toBe('test.ttf')
    const second = await store.import(fontFile(buildSfnt('My Cool Font'), 'renamed.ttf'))
    expect(second.duplicate).toBe(true)
    expect(second.font.id).toBe(first.font.id)
    const list = await store.list()
    expect(list).toHaveLength(1)
  })

  it('rejects empty, oversized and non-font files by magic bytes, not extension', async () => {
    const store = new DeviceFontStore('validation-test')
    await expect(store.import(fontFile(new Uint8Array(0)))).rejects.toMatchObject({ category: 'empty' })
    // Override the size descriptor instead of allocating a >100MB buffer
    const oversized = new NativeFile([new Uint8Array(8)], 'huge.ttf')
    Object.defineProperty(oversized, 'size', { value: DEVICE_FONT_MAX_BYTES + 1 })
    await expect(store.import(oversized)).rejects.toMatchObject({ category: 'too-large' })
    const fake = new Uint8Array(1024)
    fake.set(Buffer.from('RIFX', 'ascii'), 0)
    await expect(store.import(fontFile(fake, 'fake.ttf'))).rejects.toMatchObject({ category: 'invalid' })
    expect(sniffFontFormat(buildWoff(buildSfntTable([{ platform: 3, language: 0x409, nameId: 16, value: 'x' }])))).toBe('woff')
    expect(sniffFontFormat(buildSfnt('x'))).toBe('ttf')
  })

  it('rejects a valid-magic but undecodable file when the browser can decode fonts', async () => {
    class StubFontFace {
      constructor(_family: string, source: ArrayBuffer | ArrayBufferView) {
        this.source = source instanceof Uint8Array ? source : new Uint8Array(source as ArrayBuffer)
      }
      source: Uint8Array
      load() {
        // Emulate the browser decoder: a header-only file cannot be decoded
        return this.source.length < 16 ? Promise.reject(new Error('bad font data')) : Promise.resolve([])
      }
    }
    vi.stubGlobal('FontFace', StubFontFace)
    const store = new DeviceFontStore('decode-test')
    const headerOnly = new Uint8Array(4)
    headerOnly.set(Buffer.from('wOFF', 'ascii'), 0)
    await expect(store.import(fontFile(headerOnly, 'truncated.woff'))).rejects.toMatchObject({ category: 'invalid' })
    const valid = await store.import(fontFile(buildSfnt('Decodable')))
    expect(valid.duplicate).toBe(false)
    expect(await store.list()).toHaveLength(1)
  })

  it('keeps fonts across a storage reopen and deletes both record and file', async () => {
    const factoryStore = new DeviceFontStore('reopen-test')
    const imported = await factoryStore.import(fontFile(buildSfnt('Persisted')))
    await factoryStore.delete(imported.font.id)
    expect(await factoryStore.list()).toHaveLength(0)
    expect(await factoryStore.getBlob(imported.font.id)).toBeNull()
    const reimported = await factoryStore.import(fontFile(buildSfnt('Persisted')))
    const reopened = new DeviceFontStore('reopen-test')
    expect((await reopened.list()).map((font) => font.family)).toEqual(['Persisted'])
    expect(await reopened.getBlob(reimported.font.id)).toBeInstanceOf(NativeBlob)
  })

  it('extracts localized names with full name preferred per language', async () => {
    const names = await parseDeviceFontNames(buildSfntFromNameTable(buildSfntTable([
      { platform: 3, language: 0x409, nameId: 16, value: 'Source Han Sans' },
      { platform: 3, language: 0x804, nameId: 1, value: '思源黑体族' },
      { platform: 3, language: 0x804, nameId: 4, value: '思源黑体' },
    ])))
    expect(names.family).toBe('Source Han Sans')
    expect(names.localNames).toEqual({ '409': 'Source Han Sans', '804': '思源黑体' })
  })

  it('inflates woff1 name tables, treats woff2 as unparseable and skips malformed input', async () => {
    const longValue = 'Compressed ' + 'F'.repeat(400) + 'ace'
    const woffNames = await parseDeviceFontNames(buildWoff(buildSfntTable([
      { platform: 3, language: 0x409, nameId: 16, value: longValue },
    ])))
    expect(woffNames.family).toBe(longValue)
    expect(woffNames.localNames).toEqual({ '409': longValue })

    const woff2 = new Uint8Array(12)
    woff2.set(Buffer.from('wOF2', 'ascii'), 0)
    expect(await parseDeviceFontNames(woff2)).toEqual({ family: null, localNames: null })
    expect(await parseDeviceFontNames(new Uint8Array(4))).toEqual({ family: null, localNames: null })
  })
})

describe('device font presentation store', () => {
  it('loads the catalog, tracks preferences/order locally and restores them from localStorage', async () => {
    const { store, urls } = await freshModules()
    const database = new DeviceFontStore('bookdock-device-fonts')
    const imported = await database.import(fontFile(buildSfnt('Device Serif')))

    await store.useDeviceFontStore.getState().ensureLoaded()
    expect(store.useDeviceFontStore.getState().status).toBe('ready')
    expect(store.useDeviceFontStore.getState().fonts.map((font) => font.id)).toContain(imported.font.id)

    store.useDeviceFontStore.getState().setPreference(imported.font.id, { displayName: '手写体', enabled: false })
    store.useDeviceFontStore.getState().setOrder([imported.font.id])
    store.useDeviceFontStore.getState().selectPrimary(imported.font.id)

    const persisted = JSON.parse(localStorage.getItem('bd-device-font-presentation-v1') ?? '{}')
    expect(persisted.preferences[imported.font.id]).toEqual({ displayName: '手写体', enabled: false })
    expect(persisted.selection).toEqual({ primary: imported.font.id, cjk: null })

    // A fresh module instance (page reload) restores the device presentation
    const restored = await freshModules()
    expect(restored.store.useDeviceFontStore.getState().preferences[imported.font.id]).toEqual({ displayName: '手写体', enabled: false })
    expect(restored.store.useDeviceFontStore.getState().selection.primary).toBe(imported.font.id)
    expect(urls.useDeviceFontUrlStore.getState().urls).toEqual({})
  })

  it('reports failed imports with accurate categories and never lets imports reorder the list', async () => {
    const { store } = await freshModules()
    await expect(store.useDeviceFontStore.getState().importFont(fontFile(new Uint8Array(9), 'broken.ttf')))
      .rejects.toMatchObject({ category: 'invalid' })
    await store.useDeviceFontStore.getState().importFont(fontFile(buildSfnt('A'), 'a.ttf'))
    await store.useDeviceFontStore.getState().importFont(fontFile(buildSfnt('B'), 'b.ttf'))
    const state = store.useDeviceFontStore.getState()
    expect(state.fonts).toHaveLength(2)
    // Imports must not touch the display order: appending to an empty (or
    // partial) order would promote the fresh import to the front
    expect(state.order).toEqual([])
  })

  it('removing a font clears its metadata, preferences, order entry and device selection', async () => {
    const { store } = await freshModules()
    const database = new DeviceFontStore('bookdock-device-fonts')
    const a = await database.import(fontFile(buildSfnt('A'), 'a.ttf'))
    const b = await database.import(fontFile(buildSfnt('B'), 'b.ttf'))
    const { useDeviceFontStore } = store
    useDeviceFontStore.setState({ fonts: [a.font, b.font], order: [a.font.id, b.font.id] })
    useDeviceFontStore.getState().setPreference(a.font.id, { displayName: 'A' })
    useDeviceFontStore.getState().selectPrimary(a.font.id)
    useDeviceFontStore.getState().selectCjk(b.font.id)

    await useDeviceFontStore.getState().removeFont(a.font.id)
    const state = useDeviceFontStore.getState()
    expect(state.fonts.map((font) => font.id)).toEqual([b.font.id])
    expect(state.order).toEqual([b.font.id])
    expect(state.preferences[a.font.id]).toBeUndefined()
    expect(state.selection).toEqual({ primary: null, cjk: b.font.id })
    const persisted = JSON.parse(localStorage.getItem('bd-device-font-presentation-v1') ?? '{}')
    expect(persisted.selection.primary).toBeNull()
  })

  it('reconcileOrder applies the synced order including unknown ids, keeping device fonts attached', async () => {
    const { store } = await freshModules()
    const { useDeviceFontStore } = store
    // merged: [sans-serif, device-a, serif, device-b, lxgw-wenkai]
    useDeviceFontStore.setState({ order: ['sans-serif', 'device-a', 'serif', 'device-b', 'lxgw-wenkai'] })

    // Another device added a font and put it first
    useDeviceFontStore.getState().reconcileOrder(['new-font', 'serif', 'sans-serif', 'lxgw-wenkai'])
    // device-a follows sans-serif, device-b follows serif
    expect(useDeviceFontStore.getState().order).toEqual(['new-font', 'serif', 'device-b', 'sans-serif', 'device-a', 'lxgw-wenkai'])
    const persisted = JSON.parse(localStorage.getItem('bd-device-font-presentation-v1') ?? '{}')
    expect(persisted.order).toEqual(['new-font', 'serif', 'device-b', 'sans-serif', 'device-a', 'lxgw-wenkai'])

    // Ids the sender does not know keep their relative order at the end
    useDeviceFontStore.getState().reconcileOrder(['serif', 'new-font'])
    expect(useDeviceFontStore.getState().order).toEqual(['serif', 'device-b', 'new-font', 'sans-serif', 'device-a', 'lxgw-wenkai'])

    // No-ops: empty local order or empty synced order
    useDeviceFontStore.setState({ order: [] })
    useDeviceFontStore.getState().reconcileOrder(['serif', 'sans-serif'])
    expect(useDeviceFontStore.getState().order).toEqual([])
    useDeviceFontStore.setState({ order: ['device-a', 'sans-serif'] })
    useDeviceFontStore.getState().reconcileOrder([])
    expect(useDeviceFontStore.getState().order).toEqual(['device-a', 'sans-serif'])
  })

  it('clearSelectionFor only drops slots referencing the given ids', async () => {
    const { store } = await freshModules()
    const { useDeviceFontStore } = store
    useDeviceFontStore.setState({ selection: { primary: 'device-x', cjk: 'device-y' } })
    useDeviceFontStore.getState().clearSelectionFor(['device-z'])
    expect(useDeviceFontStore.getState().selection).toEqual({ primary: 'device-x', cjk: 'device-y' })
    useDeviceFontStore.getState().clearSelectionFor(['device-x'])
    expect(useDeviceFontStore.getState().selection).toEqual({ primary: null, cjk: 'device-y' })
  })
})

describe('device font blob URL pool', () => {
  function stubObjectUrls() {
    const revoked: string[] = []
    let counter = 0
    const created: string[] = []
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => `blob:mock-${++counter}`)
      static revokeObjectURL = vi.fn((url: string) => { revoked.push(url) })
    })
    return { revoked, created: () => created, count: () => counter }
  }

  it('shares one URL between concurrent acquirers and revokes only after the last release', async () => {
    const { urls } = await freshModules()
    stubObjectUrls()
    const database = new DeviceFontStore('bookdock-device-fonts')
    const imported = await database.import(fontFile(buildSfnt('Shared'), 'shared.ttf'))

    const first = await urls.acquireDeviceFontUrl(imported.font.id)
    const second = await urls.acquireDeviceFontUrl(imported.font.id)
    expect(first).toBe(second)
    expect(urls.useDeviceFontUrlStore.getState().urls[imported.font.id]).toBe(first)
    expect(urls.peekDeviceFontUrl(imported.font.id)).toBe(first)

    urls.releaseDeviceFontUrl(imported.font.id)
    expect(urls.peekDeviceFontUrl(imported.font.id)).toBe(first)
    urls.releaseDeviceFontUrl(imported.font.id)
    expect(urls.peekDeviceFontUrl(imported.font.id)).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first)
  })

  it('resolves null for a missing font without registering a URL', async () => {
    const { urls } = await freshModules()
    stubObjectUrls()
    await expect(urls.acquireDeviceFontUrl('device-missing')).resolves.toBeNull()
    expect(urls.useDeviceFontUrlStore.getState().urls).toEqual({})
  })

  it('releases an unmount race: release before resolve leaves one ref for the caller to compensate', async () => {
    const { urls } = await freshModules()
    const urlStub = stubObjectUrls()
    const database = new DeviceFontStore('bookdock-device-fonts')
    const imported = await database.import(fontFile(buildSfnt('Late'), 'late.ttf'))

    const pending = urls.acquireDeviceFontUrl(imported.font.id)
    // Simulate unmount racing the acquire: the pre-resolve release is a no-op
    // (the URL does not exist yet), so the holder must release once more after
    // the resolve — exactly what useDeviceFontUrls does on cleanup.
    urls.releaseDeviceFontUrl(imported.font.id)
    const url = await pending
    expect(url).not.toBeNull()
    expect(urlStub.count()).toBe(1)
    urls.releaseDeviceFontUrl(imported.font.id)
    expect(urls.peekDeviceFontUrl(imported.font.id)).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })
})
