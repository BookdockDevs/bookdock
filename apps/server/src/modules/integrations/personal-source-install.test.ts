import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { extractPackage, parseGitHubUrl } from './personal-source-install'

const manifest = { id: 'example-books', name: 'Example Books', version: '1.0.0', apiVersion: 1, entry: 'index.js' }

async function zipFrom(files: Record<string, string | Uint8Array>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, data] of Object.entries(files)) zip.file(name, data)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

describe('parseGitHubUrl', () => {
  it('accepts repository URLs, tree refs and owner/repo shorthand', () => {
    expect(parseGitHubUrl('https://github.com/octo/hello')).toEqual({ owner: 'octo', repo: 'hello' })
    expect(parseGitHubUrl('https://www.github.com/octo/hello.git/')).toEqual({ owner: 'octo', repo: 'hello' })
    expect(parseGitHubUrl('octo/hello')).toEqual({ owner: 'octo', repo: 'hello' })
    expect(parseGitHubUrl('https://github.com/octo/hello/tree/v1.0.0')).toEqual({ owner: 'octo', repo: 'hello', ref: 'v1.0.0' })
    expect(parseGitHubUrl('https://github.com/octo/hello/tree/feature/x')).toEqual({ owner: 'octo', repo: 'hello', ref: 'feature/x' })
  })

  it('rejects non-GitHub hosts and unsupported URL shapes', () => {
    expect(() => parseGitHubUrl('https://gitlab.com/octo/hello')).toThrow('github.com')
    expect(() => parseGitHubUrl('http://github.com/octo/hello')).toThrow('github.com')
    expect(() => parseGitHubUrl('https://github.com/octo/hello/blob/main/index.js')).toThrow('/tree/<ref>')
    expect(() => parseGitHubUrl('https://github.com/octo')).toThrow('repository URL')
    expect(() => parseGitHubUrl('not a url')).toThrow('repository URL')
  })
})

describe('extractPackage', () => {
  it('reads a root manifest with entry and icon and ignores other files', async () => {
    const icon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1])
    const archive = await zipFrom({
      'manifest.json': JSON.stringify({ ...manifest, icon: 'icon.png' }),
      'index.js': 'export default {}',
      'icon.png': icon,
      'extra.txt': 'ignored',
    })
    const pkg = await extractPackage(archive)
    expect(pkg.manifest.id).toBe('example-books')
    expect(pkg.entry.toString()).toBe('export default {}')
    expect(pkg.icon).toEqual({ data: expect.any(Buffer), contentType: 'image/png' })
  })

  it('strips a single common root directory', async () => {
    const archive = await zipFrom({
      'hello-main/manifest.json': JSON.stringify(manifest),
      'hello-main/lib/util.js': 'export {}',
      'hello-main/index.js': 'export default {}',
    })
    const pkg = await extractPackage(archive)
    expect(pkg.manifest.id).toBe('example-books')
    expect(pkg.entry.toString()).toBe('export default {}')
  })

  it('rejects missing or unreadable manifests and entries', async () => {
    await expect(extractPackage(await zipFrom({ 'nested/manifest.json': JSON.stringify(manifest), 'other/readme.txt': 'x' }))).rejects.toThrow('manifest.json')
    await expect(extractPackage(await zipFrom({ 'manifest.json': '{ broken' }))).rejects.toThrow('JSON')
    await expect(extractPackage(await zipFrom({ 'manifest.json': JSON.stringify(manifest) }))).rejects.toThrow('entry file was not found')
    await expect(extractPackage(await zipFrom({ 'manifest.json': JSON.stringify(manifest), 'index.js': '   ' }))).rejects.toThrow('empty')
  })

  it('rejects manifests that violate the package contract', async () => {
    await expect(extractPackage(await zipFrom({ 'manifest.json': JSON.stringify({ ...manifest, id: 'Bad Id' }), 'index.js': 'export default {}' }))).rejects.toThrow('package contract')
    await expect(extractPackage(await zipFrom({ 'manifest.json': JSON.stringify({ ...manifest, entry: '../evil.js' }), 'index.js': 'export default {}' }))).rejects.toThrow('package contract')
    await expect(extractPackage(await zipFrom({ 'manifest.json': JSON.stringify({ ...manifest, icon: '../evil.png' }) }))).rejects.toThrow('package contract')
  })

  it('rejects entries that exceed the size cap', async () => {
    const archive = await zipFrom({
      'manifest.json': JSON.stringify(manifest),
      'index.js': 'x'.repeat(3_000_000),
    })
    await expect(extractPackage(archive)).rejects.toThrow('too large')
  })

  it('rejects unsupported icon images', async () => {
    const archive = await zipFrom({
      'manifest.json': JSON.stringify({ ...manifest, icon: 'icon.png' }),
      'index.js': 'export default {}',
      'icon.png': Buffer.from([1, 2, 3, 4]),
    })
    await expect(extractPackage(archive)).rejects.toThrow('icon')
  })
})
