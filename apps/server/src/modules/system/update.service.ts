import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import JSZip from 'jszip'

import type { ErrorCode, UpdatePhase, UpdateStartReq, UpdateStatusRes } from '@bookdock/shared'
import { BOOKDOCK_BUILD_INFO, compareReleaseVersions, parseReleaseVersion, RELEASE_VERSION_PATTERN } from '@bookdock/shared'

import { config } from '../../config'
import { log } from '../../lib/logger'
import { AppError } from '../../middleware/error'
import { checkForUpdates } from './system.service'
import { createSnapshot, releaseSnapshotRetention } from './snapshots.service'

/** The only artifact line CI publishes; non-musl runtimes are refused, not supported (ADR-25 clause 11). */
const ARTIFACT_PLATFORM = 'linux-x64-musl'
const PACKAGE_TIMEOUT_MS = 5 * 60_000
const MANIFEST_TIMEOUT_MS = 10_000
const MAX_PACKAGE_BYTES = 128 * 1024 * 1024
const MAX_RELEASE_BYTES = 512 * 1024 * 1024
/** EX_TEMPFAIL: the launcher reads this exit code as "re-resolve and health-gate". */
const RESTART_FOR_UPDATE = 75
const RESTART_DELAY_MS = 250

interface ReleaseManifest {
  version: string
  nodeMajor: number
  libc: string
}

interface UpdateJob {
  progressId: string
  targetVersion: string
  phase: UpdatePhase
  error?: { code: ErrorCode; message: string }
}

interface PendingMarker {
  target: string
  snapshot: string
  progressId: string
}

interface StartReservation {
  progressId: string
  targetVersion: string
  promise?: Promise<UpdateStatusRes>
}

let job: UpdateJob | null = null
let startReservation: StartReservation | null = null

function releasesDir() {
  return path.join(config.dataDir, 'releases')
}

function assetUrl(tag: string, name: string) {
  return `${BOOKDOCK_BUILD_INFO.repositoryUrl}/releases/download/${tag}/${name}`
}

function packageName(version: string) {
  return `bookdock-${version}-${ARTIFACT_PLATFORM}.zip`
}

/** What `detectLibc` measures in `scripts/release-manifest.mjs`, seen from the running side. */
function currentLibc() {
  if (process.platform !== 'linux') return process.platform
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: unknown } }
  return typeof report.header?.glibcVersionRuntime === 'string' && report.header.glibcVersionRuntime.length > 0 ? 'glibc' : 'musl'
}

function readJsonFile<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

async function readJsonUrl(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null)
  if (!response?.ok) return null
  const text = await response.text()
  if (text.length > 64 * 1024) return null
  return readJsonFile<Record<string, unknown>>(text)
}

async function exists(file: string) {
  return stat(file).then(() => true).catch(() => false)
}

/**
 * A marker whose target does not name a launchable release is inert: the launcher
 * ignores it, so it must not block a new attempt either.
 */
async function readPending(): Promise<PendingMarker | null> {
  const parsed = await readFile(path.join(releasesDir(), 'pending'), 'utf8')
    .then((text) => readJsonFile<Partial<PendingMarker>>(text))
    .catch(() => null)
  if (typeof parsed?.target !== 'string' || !RELEASE_VERSION_PATTERN.test(parsed.target)) return null
  return { target: parsed.target, snapshot: parsed.snapshot ?? '', progressId: parsed.progressId ?? '' }
}

function toStatus(pending: PendingMarker | null): UpdateStatusRes {
  const base: UpdateStatusRes = { phase: 'idle', currentVersion: BOOKDOCK_BUILD_INFO.version }
  if (job) {
    return {
      ...base,
      phase: job.phase,
      targetVersion: job.targetVersion,
      ...(job.error ? { error: job.error } : {}),
      ...(pending ? { pendingTarget: pending.target } : {}),
    }
  }
  if (!pending) return base
  return { ...base, phase: 'restarting', targetVersion: pending.target, pendingTarget: pending.target }
}

export async function getUpdateStatus(): Promise<UpdateStatusRes> {
  return toStatus(await readPending())
}

export function clearUpdateJob() {
  job = null
  startReservation = null
}

async function downloadPackage(tag: string, version: string, file: string) {
  const response = await fetch(assetUrl(tag, packageName(version)), { signal: AbortSignal.timeout(PACKAGE_TIMEOUT_MS) }).catch(() => null)
  if (!response?.ok || !response.body) throw new AppError('UPDATE_FAILED', `Download failed: HTTP ${response?.status ?? 'unreachable'}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_PACKAGE_BYTES) throw new AppError('UPDATE_FAILED', `Package exceeds ${MAX_PACKAGE_BYTES} bytes`)

  await mkdir(path.dirname(file), { recursive: true })
  const digest = createHash('sha256')
  let received = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength
      if (received > MAX_PACKAGE_BYTES) {
        callback(new AppError('UPDATE_FAILED', `Package exceeds ${MAX_PACKAGE_BYTES} bytes`))
        return
      }
      digest.update(chunk)
      callback(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>), limiter, createWriteStream(file))
  } catch (error) {
    await rm(file, { force: true })
    throw error
  }
  if (received === 0) throw new AppError('UPDATE_FAILED', 'Package is empty')
  return digest.digest('hex')
}

async function verifyChecksum(tag: string, version: string, actual: string) {
  const response = await fetch(assetUrl(tag, `${packageName(version)}.sha256`), { signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS) }).catch(() => null)
  if (!response?.ok) throw new AppError('UPDATE_FAILED', 'Checksum asset is unavailable')
  const text = await response.text()
  if (text.length > 1024) throw new AppError('UPDATE_FAILED', 'Checksum asset is malformed')
  const expected = /^([0-9a-f]{64})/m.exec(text.trim())?.[1]
  if (!expected) throw new AppError('UPDATE_FAILED', 'Checksum asset is malformed')
  if (actual !== expected) throw new AppError('UPDATE_FAILED', `Checksum mismatch: expected ${expected}, got ${actual}`)
}

/** Extracts the archive and returns nothing safe to boot unless it holds this exact release. */
async function extractPackage(body: Buffer, appDir: string, version: string) {
  const zip = await JSZip.loadAsync(body)
  await mkdir(appDir, { recursive: true })
  let written = 0
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const dest = path.resolve(appDir, entry.name)
    // path.resolve folds `..` away, so containment is also the traversal guard.
    if (!dest.startsWith(appDir + path.sep)) throw new AppError('UPDATE_FAILED', `Archive entry escapes the release: ${entry.name}`)
    await mkdir(path.dirname(dest), { recursive: true })
    let entryBytes = 0
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        entryBytes += chunk.byteLength
        if (written + entryBytes > MAX_RELEASE_BYTES) {
          callback(new AppError('UPDATE_FAILED', `Release exceeds ${MAX_RELEASE_BYTES} bytes`))
          return
        }
        callback(null, chunk)
      },
    })
    try {
      await pipeline(entry.nodeStream('nodebuffer'), limiter, createWriteStream(dest))
    } catch (error) {
      await rm(dest, { force: true })
      throw error
    }
    written += entryBytes
  }

  const released = await readFile(path.join(appDir, 'release.json'), 'utf8')
    .then((text) => readJsonFile<ReleaseManifest>(text))
    .catch(() => null)
  if (released?.version !== version) throw new AppError('UPDATE_FAILED', `Extracted release.json says ${released?.version ?? 'nothing'}`)
  if (!(await exists(path.join(appDir, 'apps', 'server', 'dist', 'index.js')))) throw new AppError('UPDATE_FAILED', 'Extracted release has no server bundle')
}

async function writePending(marker: PendingMarker) {
  const file = path.join(releasesDir(), 'pending')
  await mkdir(releasesDir(), { recursive: true })
  const tmp = `${file}.${randomUUID()}.tmp`
  await writeFile(tmp, `${JSON.stringify(marker, null, 2)}\n`)
  try {
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/**
 * Promoted and marked: the launcher now owns the outcome, so this process has to
 * leave. WAL makes the abrupt exit crash-safe for SQLite; the in-flight request
 * has already been answered, hence the small delay.
 */
function restartForUpdate() {
  setTimeout(() => process.exit(RESTART_FOR_UPDATE), RESTART_DELAY_MS)
}

async function runUpdate(active: UpdateJob, tag: string, restart: () => void) {
  const version = active.targetVersion
  const workDir = path.join(releasesDir(), `${version}.work`)
  const appDir = path.join(workDir, 'app')
  let snapshotId: string | null = null
  try {
    active.phase = 'snapshot'
    const snapshot = await createSnapshot({ retainForUpdate: true })
    snapshotId = snapshot.id

    active.phase = 'download'
    const archive = path.join(workDir, 'package.zip')
    const checksum = await downloadPackage(tag, version, archive)

    active.phase = 'verify'
    await verifyChecksum(tag, version, checksum)
    const body = await readFile(archive)
    active.phase = 'extract'
    await extractPackage(body, appDir, version)

    active.phase = 'promote'
    const releaseDir = path.join(releasesDir(), version)
    // Only ever a strictly newer version than the one running, so this cannot
    // delete the release serving the current request.
    await rm(releaseDir, { recursive: true, force: true })
    await rename(appDir, releaseDir)
    await rm(workDir, { recursive: true, force: true })
    await writePending({ target: version, snapshot: snapshot.id, progressId: active.progressId })
    releaseSnapshotRetention(snapshot.id)

    active.phase = 'restarting'
    log('info', 'system.update.promoted', { meta: { target: version, snapshot: snapshot.id } })
    restart()
  } catch (error) {
    // Cleanup happens before the terminal phase so that a poller seeing
    // `failed` knows nothing of this attempt is left on disk.
    await rm(workDir, { recursive: true, force: true })
    if (snapshotId) releaseSnapshotRetention(snapshotId)
    active.phase = 'failed'
    active.error = {
      code: error instanceof AppError ? (error.code as ErrorCode) : 'UPDATE_FAILED',
      message: error instanceof Error ? error.message : 'Update failed',
    }
    log('error', 'system.update.failed', { meta: { target: version }, error })
  }
}

/**
 * Everything that can fail loudly runs before the response: the launcher guard,
 * the target the server itself reported, and the runtime the artifact claims to
 * match. Only then does the state machine start in the background.
 */
async function checkAndStartUpdate(input: UpdateStartReq, restart: () => void): Promise<UpdateStatusRes> {
  const pending = await readPending()
  if (pending) throw new AppError('UPDATE_IN_PROGRESS', `Release ${pending.target} is still awaiting the health gate`)

  const check = await checkForUpdates()
  const current = parseReleaseVersion(BOOKDOCK_BUILD_INFO.version)
  const target = parseReleaseVersion(input.targetVersion)
  if (!check.latestTag || check.status !== 'update-available' || check.latestVersion !== input.targetVersion) {
    throw new AppError('UPDATE_NOT_AVAILABLE', 'No matching update is available')
  }
  if (!current || !target || compareReleaseVersions(target, current) <= 0) {
    throw new AppError('UPDATE_NOT_AVAILABLE', `Version ${input.targetVersion} is not newer than ${BOOKDOCK_BUILD_INFO.version}`)
  }

  const manifest = await readJsonUrl(assetUrl(check.latestTag, 'release.json'), MANIFEST_TIMEOUT_MS) as ReleaseManifest | null
  if (!manifest || manifest.version !== input.targetVersion) {
    throw new AppError('UPDATE_NOT_AVAILABLE', `Release ${check.latestTag} publishes no readable release.json`)
  }
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (manifest.nodeMajor !== nodeMajor || manifest.libc !== currentLibc()) {
    throw new AppError('UPDATE_NOT_AVAILABLE', `Release is for ${manifest.libc}/node${manifest.nodeMajor}, this runtime is ${currentLibc()}/node${nodeMajor}. Use docker compose pull instead.`)
  }

  const active: UpdateJob = { progressId: input.progressId, targetVersion: input.targetVersion, phase: 'snapshot' }
  job = active
  void runUpdate(active, check.latestTag, restart)
  return toStatus(pending)
}

export async function startUpdate(input: UpdateStartReq, { restart = restartForUpdate }: { restart?: () => void } = {}): Promise<UpdateStatusRes> {
  if (!config.launcherNonce) {
    throw new AppError('UPDATE_NOT_LAUNCHED', 'In-app update needs the container launcher (see docs/architecture.md §9.1)')
  }
  if (job && job.phase !== 'failed') {
    if (job.progressId === input.progressId) return toStatus(await readPending())
    throw new AppError('UPDATE_IN_PROGRESS', `An update to ${job.targetVersion} is already running`)
  }
  if (startReservation) {
    if (startReservation.progressId === input.progressId && startReservation.promise) return startReservation.promise
    throw new AppError('UPDATE_IN_PROGRESS', `An update to ${startReservation.targetVersion} is already starting`)
  }

  const reservation: StartReservation = {
    progressId: input.progressId,
    targetVersion: input.targetVersion,
  }
  startReservation = reservation
  const promise = checkAndStartUpdate(input, restart)
  reservation.promise = promise
  try {
    return await promise
  } finally {
    if (startReservation === reservation) startReservation = null
  }
}
