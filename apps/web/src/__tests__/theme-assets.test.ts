import { act, renderHook, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stageThemeAsset, useThemeAssetUrls } from '../features/reading-theme/asset-urls'
import { THEME_ASSET_LIMITS, ThemeAssetStore, prepareThemeAsset, readImageDimensions, sniffImageMime } from '../features/reading-theme/assets'

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a,
  0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20])
const TEXT_BYTES = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f])

function blobOf(bytes: Uint8Array, type = 'image/png'): Blob {
  return new NativeBlob([bytes as unknown as NativeBlob], { type }) as unknown as Blob
}

async function saveImage(store: ThemeAssetStore, scope: string, file: Blob, opts: { name?: string } = {}) {
  const image = await prepareThemeAsset(scope, file, opts.name)
  const stored = await store.storePrepared(scope, [{ key: image.asset.id, image }])
  const asset = stored.get(image.asset.id)!
  return { asset, duplicate: asset.id !== image.asset.id }
}

/** Distinct image bytes, prepared in one go: the cap tests need every entry to hash differently. */
async function distinctImages(scope: string, count: number): Promise<Array<{ key: string; image: Awaited<ReturnType<typeof prepareThemeAsset>> }>> {
  return Promise.all(Array.from({ length: count }, async (_, index) => ({
    key: String(index),
    image: await prepareThemeAsset(scope, blobOf(new Uint8Array([...PNG_1X1, index & 0xff, (index >> 8) & 0xff]))),
  })))
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('File', NativeFile)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sniffImageMime', () => {
  it('recognizes PNG, JPEG and WebP from magic bytes only', () => {
    expect(sniffImageMime(PNG_1X1)).toBe('image/png')
    expect(sniffImageMime(JPEG_BYTES)).toBe('image/jpeg')
    expect(sniffImageMime(WEBP_BYTES)).toBe('image/webp')
  })

  it('rejects other content and short input', () => {
    expect(sniffImageMime(TEXT_BYTES)).toBeNull()
    expect(sniffImageMime(new Uint8Array([0x89, 0x50]))).toBeNull()
  })
})

describe('readImageDimensions', () => {
  it('falls back to header parsing when the decoder is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    expect(await readImageDimensions(PNG_1X1, 'image/png')).toEqual({ width: 1, height: 1 })
  })

  it('rejects undecodable input', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    expect(await readImageDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]), 'image/png')).toBeNull()
  })
})

describe('ThemeAssetStore', () => {
  it('stores, lists and loads per scope', async () => {
    const store = new ThemeAssetStore()
    const { asset } = await saveImage(store, 'user-1', blobOf(PNG_1X1), { name: 'wall.png' })
    expect(asset.id).toMatch(/^asset-/)
    expect(asset.mime).toBe('image/png')
    expect(asset.fileName).toBe('wall.png')
    expect((await store.list('user-1')).map((meta) => meta.id)).toEqual([asset.id])
    expect(await store.list('user-2')).toEqual([])
    const blob = await store.getBlob('user-1', asset.id)
    expect(blob).not.toBeNull()
    expect(await store.getBlob('user-2', asset.id)).toBeNull()
  })

  it('dedupes re-imports of the same bytes within a scope but not across scopes', async () => {
    const store = new ThemeAssetStore()
    const first = await saveImage(store, 'user-1', blobOf(PNG_1X1))
    const second = await saveImage(store, 'user-1', blobOf(PNG_1X1))
    expect(second.duplicate).toBe(true)
    expect(second.asset.id).toBe(first.asset.id)
    const other = await saveImage(store, 'user-2', blobOf(PNG_1X1))
    expect(other.duplicate).toBe(false)
    expect(other.asset.id).not.toBe(first.asset.id)
  })

  it('rejects oversized, empty and non-image files', async () => {
    const store = new ThemeAssetStore()
    await expect(saveImage(store, 'user-1', blobOf(new Uint8Array(0)))).rejects.toMatchObject({ category: 'empty' })
    await expect(saveImage(store, 'user-1', blobOf(new Uint8Array(THEME_ASSET_LIMITS.maxBytes + 1)))).rejects.toMatchObject({ category: 'too-large' })
    await expect(saveImage(store, 'user-1', blobOf(TEXT_BYTES))).rejects.toMatchObject({ category: 'invalid' })
    await expect(saveImage(store, 'user-1', blobOf(WEBP_BYTES))).rejects.toMatchObject({ category: 'invalid' })
  })

  it('enforces the per-scope count and byte caps', async () => {
    const store = new ThemeAssetStore()
    await store.storePrepared('user-1', await distinctImages('user-1', THEME_ASSET_LIMITS.maxPerScope))
    await expect(saveImage(store, 'user-1', blobOf(new Uint8Array([...PNG_1X1, 0xff, 0xff])))).rejects.toMatchObject({ category: 'too-many' })
  })

  it('persists a staged ID used by live CSS and preserves the previously saved image', async () => {
    const store = new ThemeAssetStore()
    const prior = await saveImage(store, 'user-1', blobOf(PNG_1X1))
    const prepared = await prepareThemeAsset('user-1', blobOf(PNG_1X1, 'application/octet-stream'))
    expect(await store.getBlob('user-1', prepared.asset.id)).toBeNull()
    expect(prepared.blob.type).toBe('image/png')
    await store.storePrepared('user-1', [{ key: 'draft', image: prepared, keepId: true }])
    expect(await store.getBlob('user-1', prepared.asset.id)).not.toBeNull()
    expect(await store.getBlob('user-1', prior.asset.id)).not.toBeNull()
  })

  it('dedupes concurrent writes and rolls back at the scope limit', async () => {
    const store = new ThemeAssetStore()
    const [first, second] = await Promise.all([
      saveImage(store, 'user-1', blobOf(PNG_1X1)),
      saveImage(new ThemeAssetStore(), 'user-1', blobOf(PNG_1X1)),
    ])
    expect(second.asset.id).toBe(first.asset.id)
    await store.storePrepared('user-1', await distinctImages('user-1', THEME_ASSET_LIMITS.maxPerScope - 2))
    const before = await store.list('user-1')
    const entries = await Promise.all([PNG_1X1, new Uint8Array([...PNG_1X1, 254]), new Uint8Array([...PNG_1X1, 255])].map(async (bytes, index) => ({
      key: String(index),
      image: await prepareThemeAsset('user-1', blobOf(bytes)),
    })))
    await expect(store.storePrepared('user-1', entries)).rejects.toMatchObject({ category: 'too-many' })
    expect(await store.list('user-1')).toEqual(before)
    expect(await store.getBlob('user-1', first.asset.id)).not.toBeNull()
  })

})

describe('theme asset URL lifetime', () => {
  it('exposes IDs in the selected scope and keeps a trial URL alive until its consumers release it', async () => {
    const create = vi.fn().mockReturnValue('blob:http://localhost/draft')
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    const release = stageThemeAsset('user-1', 'shared-id', blobOf(PNG_1X1))
    const { result, rerender, unmount } = renderHook(
      ({ scope }) => useThemeAssetUrls(scope, ['shared-id']),
      { initialProps: { scope: 'user-1' } },
    )
    await waitFor(() => expect(result.current.urls['shared-id']).toBe('blob:http://localhost/draft'))
    await act(async () => release())
    expect(revoke).not.toHaveBeenCalled()
    rerender({ scope: 'user-2' })
    expect(result.current.urls['shared-id']).toBeUndefined()
    await waitFor(() => expect(result.current.missing).toEqual(['shared-id']))
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/draft')
    unmount()
  })
})
