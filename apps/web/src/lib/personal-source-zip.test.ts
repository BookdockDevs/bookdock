import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'

import { extractZipPreview } from './personal-source-zip'

async function zipFrom(files: Record<string, string | Uint8Array>): Promise<File> {
  const zip = new JSZip()
  for (const [name, data] of Object.entries(files)) zip.file(name, data)
  const buffer = await zip.generateAsync({ type: 'uint8array' })
  return new File([buffer], 'source.zip', { type: 'application/zip' })
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

describe('extractZipPreview', () => {
  it('extracts the manifest name and root icon', async () => {
    const preview = await extractZipPreview(
      await zipFrom({
        'manifest.json': JSON.stringify({ id: 'x', name: '七猫小说', icon: 'icon.png' }),
        'index.js': '',
        'icon.png': PNG,
      }),
    )
    expect(preview.name).toBe('七猫小说')
    expect(preview.iconUrl).toBeTypeOf('string')
    URL.revokeObjectURL(preview.iconUrl!)
  })

  it('extracts an icon and name from a single common top-level directory', async () => {
    const preview = await extractZipPreview(
      await zipFrom({
        'repo-main/manifest.json': JSON.stringify({ id: 'x', name: 'Example', icon: 'assets/icon.webp' }),
        'repo-main/index.js': '',
        'repo-main/assets/icon.webp': WEBP,
      }),
    )
    expect(preview.name).toBe('Example')
    expect(preview.iconUrl).toBeTypeOf('string')
    URL.revokeObjectURL(preview.iconUrl!)
  })

  it('degrades icon and name independently', async () => {
    const noIcon = await extractZipPreview(await zipFrom({ 'manifest.json': JSON.stringify({ id: 'x', name: 'Example' }) }))
    expect(noIcon).toEqual({ iconUrl: null, name: 'Example' })

    const noName = await extractZipPreview(
      await zipFrom({ 'manifest.json': JSON.stringify({ id: 'x', icon: 'icon.png' }), 'icon.png': PNG }),
    )
    expect(noName.name).toBeNull()
    expect(noName.iconUrl).toBeTypeOf('string')
    URL.revokeObjectURL(noName.iconUrl!)

    const missingIconFile = await extractZipPreview(
      await zipFrom({ 'manifest.json': JSON.stringify({ id: 'x', name: 'Example', icon: 'missing.png' }) }),
    )
    expect(missingIconFile).toEqual({ iconUrl: null, name: 'Example' })
  })

  it('returns nulls for packages without an icon or manifest', async () => {
    expect(await extractZipPreview(await zipFrom({ 'index.js': '' }))).toEqual({ iconUrl: null, name: null })
    expect(
      await extractZipPreview(await zipFrom({ 'a/manifest.json': '{"name":"A"}', 'b/manifest.json': '{"name":"B"}' })),
    ).toEqual({ iconUrl: null, name: null })
  })

  it('rejects icon paths that escape the package root', async () => {
    expect(
      await extractZipPreview(
        await zipFrom({ 'manifest.json': JSON.stringify({ id: 'x', name: 'Example', icon: '../icon.png' }), 'icon.png': PNG }),
      ),
    ).toEqual({ iconUrl: null, name: 'Example' })
  })

  it('returns nulls for files that are not valid ZIP archives', async () => {
    expect(await extractZipPreview(new File(['not a zip'], 'x.zip'))).toEqual({ iconUrl: null, name: null })
  })
})
