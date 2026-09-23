import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '../../middleware/error'
import { checkForUpdates } from './system.service'
import { createSnapshot } from './snapshots.service'
import { clearUpdateJob, getUpdateStatus, startUpdate } from './update.service'
import { config } from '../../config'

const { settings } = vi.hoisted(() => ({ settings: { dataDir: '', launcherNonce: 'test-nonce' as string | undefined } }))

vi.mock('../../config', async () => {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  settings.dataDir = nodePath.join(os.tmpdir(), `bookdock-update-test-${process.pid}`)
  return { config: settings }
})

vi.mock('./system.service', () => ({ checkForUpdates: vi.fn() }))
vi.mock('./snapshots.service', () => ({ createSnapshot: vi.fn(), releaseSnapshotRetention: vi.fn() }))

const TARGET = '0.4.0'
const TAG = 'v0.4.0'
const DOWNLOAD_BASE = `https://github.com/BookdockDevs/bookdock/releases/download/${TAG}`
const PACKAGE_NAME = `bookdock-${TARGET}-linux-x64-musl.zip`
let RELEASES_DIR = path.join(config.dataDir, 'releases')

function currentLibc() {
  if (process.platform !== 'linux') return process.platform
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: unknown } }
  return typeof report.header?.glibcVersionRuntime === 'string' && report.header.glibcVersionRuntime.length > 0 ? 'glibc' : 'musl'
}

/** Mirrors what CI writes, without importing the un-typechecked build script. */
function runtimeManifest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: TARGET,
    nodeMajor: Number(process.versions.node.split('.')[0]),
    libc: currentLibc(),
    createdAt: 1_760_000_000_000,
    ...overrides,
  })
}

async function packageBytes(entries: Record<string, string>) {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(entries)) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer' })
}

function defaultPackage() {
  return packageBytes({
    'release.json': runtimeManifest(),
    'apps/server/dist/index.js': 'export {}',
    'apps/web/dist/index.html': '<html></html>',
  })
}

/** A fetch stub answering exactly the three assets the updater asks for. */
function stubAssets(assets: Record<string, string | Buffer | Error>) {
  vi.stubGlobal('fetch', async (url: string | URL) => {
    const key = String(url)
    const asset = assets[key]
    if (asset instanceof Error) throw asset
    if (asset === undefined) return new Response('not found', { status: 404 })
    return new Response(asset)
  })
}

async function writePending(marker: unknown) {
  await mkdir(RELEASES_DIR, { recursive: true })
  await writeFile(path.join(RELEASES_DIR, 'pending'), `${JSON.stringify(marker)}\n`)
}

async function exists(file: string) {
  return stat(file).then(() => true).catch(() => false)
}

async function settled() {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const status = await getUpdateStatus()
    if (status.phase === 'restarting' || status.phase === 'failed') return status
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('update job never reached a terminal phase')
}

function expectedManifest() {
  return { [`${DOWNLOAD_BASE}/release.json`]: runtimeManifest() }
}

beforeEach(async () => {
  settings.dataDir = path.join(tmpdir(), `bookdock-update-test-${process.pid}-${randomUUID()}`)
  RELEASES_DIR = path.join(config.dataDir, 'releases')
  clearUpdateJob()
  vi.unstubAllGlobals()
  // Default: every asset URL 404s, so no test can reach the network by accident.
  stubAssets({})
  vi.mocked(checkForUpdates).mockResolvedValue({ status: 'update-available', currentVersion: '0.3.2', latestVersion: TARGET, latestTag: TAG, releaseUrl: 'https://github.com/x' })
  vi.mocked(createSnapshot).mockResolvedValue({ id: `0.3.2-${1_760_000_000_000}`, appVersion: '0.3.2', createdAt: 1_760_000_000_000, sizeBytes: 1 })
  settings.launcherNonce = 'test-nonce'
  await rm(config.dataDir, { recursive: true, force: true })
})

afterEach(async () => {
  vi.clearAllMocks()
  await rm(config.dataDir, { recursive: true, force: true })
})

describe('update guards', () => {
  it('refuses to update when no launcher injected a nonce', async () => {
    settings.launcherNonce = undefined

    await expect(startUpdate({ targetVersion: TARGET, progressId: 'p1' })).rejects.toThrow(/launcher/)
  })

  it('refuses while a promoted release is still awaiting the health gate', async () => {
    await writePending({ target: '0.3.9', snapshot: 's', progressId: 'p0' })

    await expect(startUpdate({ targetVersion: TARGET, progressId: 'p1' })).rejects.toMatchObject({ code: 'UPDATE_IN_PROGRESS' })
  })

  it('ignores a pending marker that names no launchable release', async () => {
    await writePending({ target: '../escaped', snapshot: 's', progressId: 'p0' })
    vi.mocked(checkForUpdates).mockResolvedValue({ status: 'up-to-date', currentVersion: '0.3.2' })

    await expect(startUpdate({ targetVersion: TARGET, progressId: 'p1' })).rejects.toMatchObject({ code: 'UPDATE_NOT_AVAILABLE' })
  })

  it('refuses a target the update check did not report', async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({ status: 'up-to-date', currentVersion: '0.3.2' })
    settings.launcherNonce = 'test-nonce'

    await expect(startUpdate({ targetVersion: TARGET, progressId: 'p1' })).rejects.toMatchObject({ code: 'UPDATE_NOT_AVAILABLE' })
  })

  it('refuses an artifact built for a different runtime before writing any bytes', async () => {
    stubAssets({ [`${DOWNLOAD_BASE}/release.json`]: runtimeManifest({ libc: '_plan9' }) })

    await expect(startUpdate({ targetVersion: TARGET, progressId: 'p1' })).rejects.toMatchObject({ code: 'UPDATE_NOT_AVAILABLE' })
    expect(await exists(RELEASES_DIR)).toBe(false)
  })

  it('treats a retried progressId as the same job and a new one as a conflict', async () => {
    const archive = await defaultPackage()
    stubAssets({
      ...expectedManifest(),
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}`]: archive,
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}.sha256`]: createHash('sha256').update(archive).digest('hex'),
    })
    await startUpdate({ targetVersion: TARGET, progressId: 'p1' }, { restart: vi.fn() })
    await settled()

    await expect(startUpdate({ targetVersion: TARGET, progressId: 'p1' })).resolves.toMatchObject({ targetVersion: TARGET, phase: 'restarting' })
    await expect(startUpdate({ targetVersion: TARGET, progressId: 'p2' })).rejects.toMatchObject({ code: 'UPDATE_IN_PROGRESS' })
  })

  it('reserves the single-flight slot before asynchronous preflight', async () => {
    const archive = await defaultPackage()
    stubAssets({
      ...expectedManifest(),
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}`]: archive,
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}.sha256`]: createHash('sha256').update(archive).digest('hex'),
    })
    let releaseCheck: ((result: Awaited<ReturnType<typeof checkForUpdates>>) => void) | undefined
    vi.mocked(checkForUpdates).mockImplementation(() => new Promise((resolve) => { releaseCheck = resolve }))

    const first = startUpdate({ targetVersion: TARGET, progressId: 'p1' }, { restart: vi.fn() })
    await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(1))
    const retry = startUpdate({ targetVersion: TARGET, progressId: 'p1' })
    await expect(startUpdate({ targetVersion: TARGET, progressId: 'p2' })).rejects.toMatchObject({ code: 'UPDATE_IN_PROGRESS' })
    expect(checkForUpdates).toHaveBeenCalledTimes(1)

    releaseCheck?.({ status: 'update-available', currentVersion: '0.3.2', latestVersion: TARGET, latestTag: TAG, releaseUrl: 'https://github.com/x' })
    await expect(Promise.all([first, retry])).resolves.toEqual([
      { phase: 'snapshot', currentVersion: '0.3.2', targetVersion: TARGET },
      { phase: 'snapshot', currentVersion: '0.3.2', targetVersion: TARGET },
    ])
    expect(await settled()).toMatchObject({ phase: 'restarting', targetVersion: TARGET })
  })
})

describe('update state machine', () => {
  it('promotes the release, marks it pending and asks the launcher to take over', async () => {
    const archive = await defaultPackage()
    stubAssets({
      ...expectedManifest(),
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}`]: archive,
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}.sha256`]: `${createHash('sha256').update(archive).digest('hex')}  ${PACKAGE_NAME}`,
    })
    const restart = vi.fn()

    await startUpdate({ targetVersion: TARGET, progressId: 'p1' }, { restart })
    expect(await settled()).toMatchObject({ phase: 'restarting', targetVersion: TARGET })

    expect(restart).toHaveBeenCalledTimes(1)
    expect(await readFile(path.join(RELEASES_DIR, TARGET, 'apps', 'server', 'dist', 'index.js'), 'utf8')).toBe('export {}')
    expect(await readFile(path.join(RELEASES_DIR, 'pending'), 'utf8')).toContain(`0.3.2-${1_760_000_000_000}`)
    expect((await readdir(path.join(RELEASES_DIR, TARGET))).sort()).toEqual(['apps', 'release.json'])
    expect(await exists(path.join(RELEASES_DIR, `${TARGET}.work`))).toBe(false)
  })

  it('fails on a checksum mismatch and leaves nothing promoted', async () => {
    stubAssets({
      ...expectedManifest(),
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}`]: await defaultPackage(),
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}.sha256`]: `${'0'.repeat(64)}  ${PACKAGE_NAME}`,
    })

    await startUpdate({ targetVersion: TARGET, progressId: 'p1' }, { restart: vi.fn() })
    expect(await settled()).toMatchObject({ phase: 'failed', error: { code: 'UPDATE_FAILED' } })
    expect(await exists(path.join(RELEASES_DIR, TARGET))).toBe(false)
    expect(await exists(path.join(RELEASES_DIR, 'pending'))).toBe(false)
  })

  // JSZip folds `..` segments itself, so the reachable escape is an absolute
  // entry name — which is what the containment check exists for.
  it('refuses an archive entry that escapes the release directory', async () => {
    const archive = await packageBytes({
      'release.json': runtimeManifest(),
      'apps/server/dist/index.js': 'export {}',
      '/escape.js': 'payload',
    })
    stubAssets({
      ...expectedManifest(),
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}`]: archive,
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}.sha256`]: `${createHash('sha256').update(archive).digest('hex')}`,
    })

    await startUpdate({ targetVersion: TARGET, progressId: 'p1' }, { restart: vi.fn() })
    expect(await settled()).toMatchObject({ phase: 'failed', error: { message: expect.stringContaining('/escape.js') } })
    expect(await exists(path.join(RELEASES_DIR, TARGET))).toBe(false)
    expect(await exists(path.join(RELEASES_DIR, `${TARGET}.work`))).toBe(false)
  })

  it('refuses an archive whose own release.json names another version', async () => {
    const archive = await packageBytes({
      'release.json': runtimeManifest({ version: '9.9.9' }),
      'apps/server/dist/index.js': 'export {}',
    })
    stubAssets({
      ...expectedManifest(),
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}`]: archive,
      [`${DOWNLOAD_BASE}/${PACKAGE_NAME}.sha256`]: `${createHash('sha256').update(archive).digest('hex')}`,
    })

    await startUpdate({ targetVersion: TARGET, progressId: 'p1' }, { restart: vi.fn() })
    expect(await settled()).toMatchObject({ phase: 'failed', error: { message: expect.stringContaining('9.9.9') } })
    expect(await exists(path.join(RELEASES_DIR, TARGET))).toBe(false)
  })

  it('keeps the snapshot error code when the pre-update snapshot fails', async () => {
    stubAssets(expectedManifest())
    vi.mocked(createSnapshot).mockRejectedValue(new AppError('SNAPSHOT_CREATE_FAILED', 'disk full'))

    await startUpdate({ targetVersion: TARGET, progressId: 'p1' }, { restart: vi.fn() })
    expect(await settled()).toMatchObject({ phase: 'failed', error: { code: 'SNAPSHOT_CREATE_FAILED' } })
  })
})

describe('update status', () => {
  it('is idle with no job and no pending marker', async () => {
    expect(await getUpdateStatus()).toEqual({ phase: 'idle', currentVersion: '0.3.2' })
  })

  it('reports the promoted release after the updating process is gone', async () => {
    await writePending({ target: TARGET, snapshot: '0.3.2-1760000000000', progressId: 'p1' })
    clearUpdateJob()

    expect(await getUpdateStatus()).toMatchObject({ phase: 'restarting', currentVersion: '0.3.2', targetVersion: TARGET, pendingTarget: TARGET })
  })
})
