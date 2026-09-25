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
import { checkForUpdates, describeUpdateNetworkFailure } from './system.service'
import { createSnapshot, releaseSnapshotRetention } from './snapshots.service'

/** The only artifact line CI publishes; non-musl runtimes are refused, not supported (ADR-25 clause 11). */
const ARTIFACT_PLATFORM = 'linux-x64-musl'
const PACKAGE_TIMEOUT_MS = 5 * 60_000
const MANIFEST_TIMEOUT_MS = 10_000
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000
const MAX_PACKAGE_BYTES = 128 * 1024 * 1024
const MAX_RELEASE_BYTES = 512 * 1024 * 1024
/** EX_TEMPFAIL: the launcher reads this exit code as "re-resolve and health-gate". */
const RESTART_FOR_UPDATE = 75
const RESTART_DELAY_MS = 250

interface ReleaseManifest {
  version: string
  nodeMajor: number
  libc: string
  /** Build architecture (e.g. x64); absent in pre-0.3.7 manifests. */
  arch?: string
}

interface UpdateJob {
  progressId: string
  targetVersion: string
  phase: UpdatePhase
  outcome: 'active' | 'succeeded' | 'failed' | 'cancelled' | 'rolled-back'
  startedAt: number
  updatedAt: number
  phaseStartedAt: number
  previousPhase?: UpdatePhase
  action?: string
  snapshot?: { pages?: number; totalPages?: number }
  download?: { state: 'connecting' | 'receiving'; receivedBytes: number; totalBytes?: number; lastDataAt?: number }
  extraction?: { files: number; bytes: number; totalBytes?: number; totalFiles?: number }
  controller: AbortController
  cancelRequested?: boolean
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
let persistChain: Promise<void> = Promise.resolve()

function releasesDir() {
  return path.join(config.dataDir, 'releases')
}

function stateFile() {
  return path.join(releasesDir(), 'update-state.json')
}

async function persistJob(active: UpdateJob) {
  active.updatedAt = Date.now()
  const { controller: _controller, ...safe } = active
  const write = persistChain.then(async () => {
    const file = stateFile()
    await mkdir(releasesDir(), { recursive: true })
    const tmp = `${file}.${randomUUID()}.tmp`
    await writeFile(tmp, `${JSON.stringify(safe)}\n`)
    await rename(tmp, file)
  })
  persistChain = write.catch(() => undefined)
  await write
}

function setPhase(active: UpdateJob, phase: UpdatePhase, action: string) {
  active.phase = phase
  active.action = action
  active.phaseStartedAt = Date.now()
  void persistJob(active).catch(() => undefined)
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

async function readJsonUrl(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  let response: Response
  try {
    response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new AppError('UPDATE_FAILED', describeUpdateNetworkFailure(error, 'Release manifest request'))
  }
  if (!response.ok) throw new AppError('UPDATE_FAILED', `Release manifest request returned HTTP ${response.status}`)
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
      outcome: job.outcome,
      targetVersion: job.targetVersion,
      progressId: job.progressId,
      action: job.action,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      phaseStartedAt: job.phaseStartedAt,
      elapsedMs: Date.now() - job.startedAt,
      ...(job.snapshot ? { snapshot: job.snapshot } : {}),
      ...(job.download ? { download: job.download } : {}),
      ...(job.extraction ? { extraction: job.extraction } : {}),
      diagnostic: { requestId: job.progressId, startedAt: job.startedAt, updatedAt: job.updatedAt, phaseStartedAt: job.phaseStartedAt, previousPhase: job.previousPhase, ...(job.outcome !== 'active' ? { finishedAt: job.updatedAt } : {}), phase: job.previousPhase ?? job.phase, ...(job.error ? { errorCode: job.error.code, message: job.error.message } : {}) },
      ...(job.error ? { error: job.error } : {}),
      ...(pending ? { pendingTarget: pending.target } : {}),
    }
  }
  if (!pending) return base
  return { ...base, phase: 'restarting', targetVersion: pending.target, pendingTarget: pending.target }
}

export async function getUpdateStatus(): Promise<UpdateStatusRes> {
  const pending = await readPending()
  if (job) return toStatus(pending)
  await persistChain
  const saved = await readFile(stateFile(), 'utf8').then((text) => readJsonFile<UpdateStatusRes>(text)).catch(() => null)
  if (pending) return { ...toStatus(pending), ...(saved?.progressId === pending.progressId ? saved : {}) }
  if (saved && saved.phase !== 'idle') {
    const status = saved as UpdateStatusRes
    return {
      ...status,
      currentVersion: BOOKDOCK_BUILD_INFO.version,
      ...(status.startedAt ? { elapsedMs: Date.now() - status.startedAt } : {}),
      ...(status.progressId && status.startedAt ? { diagnostic: status.diagnostic ?? { requestId: status.progressId, startedAt: status.startedAt, updatedAt: status.updatedAt, phaseStartedAt: status.phaseStartedAt, previousPhase: status.previousPhase, ...(status.outcome !== 'active' ? { finishedAt: status.updatedAt } : {}), phase: status.previousPhase ?? status.phase, ...(status.error ? { errorCode: status.error.code, message: status.error.message } : {}) } } : {}),
    }
  }
  return toStatus(null)
}

export function clearUpdateJob() {
  job = null
  startReservation = null
}

async function downloadPackage(tag: string, version: string, file: string, active: UpdateJob) {
  const overallTimeout = AbortSignal.timeout(PACKAGE_TIMEOUT_MS)
  setPhase(active, 'download', 'Connecting to release server')
  active.download = { state: 'connecting', receivedBytes: 0 }
  await persistJob(active)
  let response: Response
  try {
    response = await fetch(assetUrl(tag, packageName(version)), { signal: AbortSignal.any([active.controller.signal, overallTimeout]) })
  } catch (error) {
    if (active.controller.signal.aborted) throw error
    throw new AppError('UPDATE_FAILED', describeUpdateNetworkFailure(error, 'Package download connection'))
  }
  if (!response.ok) throw new AppError('UPDATE_FAILED', `Package download returned HTTP ${response.status}`)
  if (!response.body) throw new AppError('UPDATE_FAILED', 'Package download response did not include a body')
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_PACKAGE_BYTES) throw new AppError('UPDATE_FAILED', `Package exceeds ${MAX_PACKAGE_BYTES} bytes`)

  await mkdir(path.dirname(file), { recursive: true })
  const digest = createHash('sha256')
  let received = 0
  active.action = 'Release server responded; receiving package data'
  active.download = { state: 'receiving', receivedBytes: 0, ...(Number.isFinite(declared) && declared > 0 ? { totalBytes: declared } : {}) }
  await persistJob(active)
  let lastPersist = Date.now()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => active.controller.abort(new Error('Download timed out without receiving data')), DOWNLOAD_IDLE_TIMEOUT_MS)
  }
  resetIdleTimer()
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (active.controller.signal.aborted) { callback(new Error('Update cancelled')); return }
      received += chunk.byteLength
      if (received > MAX_PACKAGE_BYTES) {
        callback(new AppError('UPDATE_FAILED', `Package exceeds ${MAX_PACKAGE_BYTES} bytes`))
        return
      }
      digest.update(chunk)
      resetIdleTimer()
      active.download = { ...active.download!, receivedBytes: received, lastDataAt: Date.now() }
      if (received === chunk.byteLength || Date.now() - lastPersist > 250) { lastPersist = Date.now(); void persistJob(active).catch(() => undefined) }
      callback(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>), limiter, createWriteStream(file), { signal: AbortSignal.any([active.controller.signal, overallTimeout]) })
  } catch (error) {
    await rm(file, { force: true })
    if (overallTimeout.aborted) throw new AppError('UPDATE_FAILED', 'Package download exceeded the five minute time limit')
    if (!active.cancelRequested && active.controller.signal.aborted) {
      throw new AppError('UPDATE_FAILED', active.controller.signal.reason instanceof Error ? active.controller.signal.reason.message : 'Download timed out without receiving data')
    }
    throw error
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }
  if (received === 0) throw new AppError('UPDATE_FAILED', 'Package is empty')
  return digest.digest('hex')
}

async function verifyChecksum(tag: string, version: string, actual: string, active: UpdateJob) {
  setPhase(active, 'verify', 'Checking the package SHA-256 checksum')
  let response: Response
  try {
    response = await fetch(assetUrl(tag, `${packageName(version)}.sha256`), { signal: AbortSignal.any([active.controller.signal, AbortSignal.timeout(MANIFEST_TIMEOUT_MS)]) })
  } catch (error) {
    if (active.controller.signal.aborted) throw error
    throw new AppError('UPDATE_FAILED', describeUpdateNetworkFailure(error, 'Checksum request'))
  }
  if (!response.ok) throw new AppError('UPDATE_FAILED', `Checksum request returned HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > 1024) throw new AppError('UPDATE_FAILED', 'Checksum asset is malformed')
  const expected = /^([0-9a-f]{64})/m.exec(text.trim())?.[1]
  if (!expected) throw new AppError('UPDATE_FAILED', 'Checksum asset is malformed')
  if (actual !== expected) throw new AppError('UPDATE_FAILED', `Checksum mismatch: expected ${expected}, got ${actual}`)
}

/** Extracts the archive and returns nothing safe to boot unless it holds this exact release. */
async function extractPackage(body: Buffer, appDir: string, version: string, active: UpdateJob) {
  const zip = await JSZip.loadAsync(body)
  await mkdir(appDir, { recursive: true })
  let written = 0
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  active.extraction = { files: 0, bytes: 0, totalFiles: entries.length }
  let lastPersist = Date.now()
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const dest = path.resolve(appDir, entry.name)
    // path.resolve folds `..` away, so containment is also the traversal guard.
    if (!dest.startsWith(appDir + path.sep)) throw new AppError('UPDATE_FAILED', `Archive entry escapes the release: ${entry.name}`)
    await mkdir(path.dirname(dest), { recursive: true })
    let entryBytes = 0
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        if (active.controller.signal.aborted) { callback(new Error('Update cancelled')); return }
        entryBytes += chunk.byteLength
        if (written + entryBytes > MAX_RELEASE_BYTES) {
          callback(new AppError('UPDATE_FAILED', `Release exceeds ${MAX_RELEASE_BYTES} bytes`))
          return
        }
        active.extraction = { ...active.extraction!, bytes: written + entryBytes }
        if (Date.now() - lastPersist > 250) { lastPersist = Date.now(); void persistJob(active).catch(() => undefined) }
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
    active.extraction = { ...active.extraction!, files: active.extraction!.files + 1, bytes: written }
    await persistJob(active)
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
  let lastSnapshotPersist = 0
  try {
    setPhase(active, 'snapshot', 'Creating a rollback snapshot of the database')
    const snapshot = await createSnapshot({ retainForUpdate: true, onProgress: (progress) => {
      if (active.controller.signal.aborted) throw new Error('Update cancelled')
      active.snapshot = { pages: progress.totalPages - progress.remainingPages, totalPages: progress.totalPages }
      if (Date.now() - lastSnapshotPersist > 250) {
        lastSnapshotPersist = Date.now()
        void persistJob(active).catch(() => undefined)
      }
    } })
    snapshotId = snapshot.id

    const archive = path.join(workDir, 'package.zip')
    const checksum = await downloadPackage(tag, version, archive, active)

    await verifyChecksum(tag, version, checksum, active)
    const body = await readFile(archive)
    setPhase(active, 'extract', 'Unpacking release files')
    await extractPackage(body, appDir, version, active)

    if (active.controller.signal.aborted) throw active.controller.signal.reason
    setPhase(active, 'promote', 'Preparing the verified release for startup')
    const releaseDir = path.join(releasesDir(), version)
    // Only ever a strictly newer version than the one running, so this cannot
    // delete the release serving the current request.
    await rm(releaseDir, { recursive: true, force: true })
    await rename(appDir, releaseDir)
    await rm(workDir, { recursive: true, force: true })
    await writePending({ target: version, snapshot: snapshot.id, progressId: active.progressId })
    releaseSnapshotRetention(snapshot.id)

    setPhase(active, 'restarting', 'Waiting for the launcher health check')
    log('info', 'system.update.promoted', { meta: { target: version, snapshot: snapshot.id } })
    restart()
  } catch (error) {
    // Cleanup happens before the terminal phase so that a poller seeing
    // `failed` knows nothing of this attempt is left on disk.
    const cleanupError = await rm(workDir, { recursive: true, force: true }).then(() => null).catch((failure: unknown) => failure)
    if (snapshotId) releaseSnapshotRetention(snapshotId)
    active.previousPhase = active.phase
    const cancelled = active.cancelRequested && !cleanupError
    active.phase = cancelled ? 'cancelled' : 'failed'
    active.outcome = cancelled ? 'cancelled' : 'failed'
    active.error = {
      code: error instanceof AppError ? (error.code as ErrorCode) : 'UPDATE_FAILED',
      message: cancelled ? 'Update cancelled; the current version is still running' : cleanupError ? `Update failed and temporary files could not be removed: ${sanitizeUpdateError(cleanupError)}` : active.cancelRequested ? 'Cancellation did not complete; the current version is still running' : sanitizeUpdateError(error),
    }
    await persistJob(active).catch(() => undefined)
    log('error', 'system.update.failed', { meta: { target: version }, error })
  }
}

/**
 * Everything that can fail loudly runs before the response: the launcher guard,
 * the target the server itself reported, and the runtime the artifact claims to
 * match. Only then does the state machine start in the background.
 */
async function checkAndStartUpdate(input: UpdateStartReq, active: UpdateJob, restart: () => void): Promise<UpdateStatusRes> {
  setPhase(active, 'check', 'Checking the latest release and runtime compatibility')
  const pending = await readPending()
  if (pending) throw new AppError('UPDATE_IN_PROGRESS', `Release ${pending.target} is still awaiting the health gate`)

  const check = await checkForUpdates(active.controller.signal)
  if (active.controller.signal.aborted) throw active.controller.signal.reason
  if (check.status === 'unavailable') throw new AppError('UPDATE_FAILED', check.failureReason ?? 'Could not retrieve release information from GitHub; check container network access and try again')
  const current = parseReleaseVersion(BOOKDOCK_BUILD_INFO.version)
  const target = parseReleaseVersion(input.targetVersion)
  if (!check.latestTag || check.status !== 'update-available' || check.latestVersion !== input.targetVersion) {
    throw new AppError('UPDATE_NOT_AVAILABLE', 'No matching update is available')
  }
  if (!current || !target || compareReleaseVersions(target, current) <= 0) {
    throw new AppError('UPDATE_NOT_AVAILABLE', `Version ${input.targetVersion} is not newer than ${BOOKDOCK_BUILD_INFO.version}`)
  }

  active.action = 'Checking release package compatibility'
  await persistJob(active)
  const manifest = await readJsonUrl(assetUrl(check.latestTag, 'release.json'), MANIFEST_TIMEOUT_MS, active.controller.signal) as ReleaseManifest | null
  if (!manifest || manifest.version !== input.targetVersion) {
    throw new AppError('UPDATE_NOT_AVAILABLE', `Release ${check.latestTag} publishes no readable release.json`)
  }
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (manifest.nodeMajor !== nodeMajor || manifest.libc !== currentLibc()) {
    throw new AppError('UPDATE_NOT_AVAILABLE', `Release is for ${manifest.libc}/node${manifest.nodeMajor}, this runtime is ${currentLibc()}/node${nodeMajor}. Use docker compose pull instead.`)
  }

  if (active.controller.signal.aborted) throw active.controller.signal.reason
  void runUpdate(active, check.latestTag, restart)
  return toStatus(pending)
}

function sanitizeUpdateError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Update failed'
  return message
    .replace(/https?:\/\/\S+/gi, '[release URL]')
    .replace(/(?:token|password|secret|authorization)[=: ]+[^\s,;]+/gi, '[credential redacted]')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/\/(?:app|data|tmp)\/[^\s]+/g, '[path]')
    .slice(0, 240)
}

export async function cancelUpdate(progressId: string) {
  if (!job || job.progressId !== progressId) throw new AppError('UPDATE_NOT_AVAILABLE', 'No cancellable update matches this request')
  if (['promote', 'restarting'].includes(job.phase)) throw new AppError('UPDATE_IN_PROGRESS', 'Version switching has started; the launcher health check cannot be cancelled')
  job.cancelRequested = true
  job.action = 'Stopping update and cleaning temporary files'
  void persistJob(job).catch(() => undefined)
  job.controller.abort(new Error('Update cancelled by owner'))
  return getUpdateStatus()
}

export async function startUpdate(input: UpdateStartReq, { restart = restartForUpdate }: { restart?: () => void } = {}): Promise<UpdateStatusRes> {
  if (!config.launcherNonce) {
    throw new AppError('UPDATE_NOT_LAUNCHED', 'In-app update needs the container launcher (see docs/architecture.md §9.1)')
  }
  if (startReservation) {
    if (startReservation.progressId === input.progressId && startReservation.promise) return startReservation.promise
    throw new AppError('UPDATE_IN_PROGRESS', `An update to ${startReservation.targetVersion} is already starting`)
  }
  if (job && !['failed', 'cancelled'].includes(job.phase)) {
    if (job.progressId === input.progressId) return toStatus(await readPending())
    throw new AppError('UPDATE_IN_PROGRESS', `An update to ${job.targetVersion} is already running`)
  }

  const reservation: StartReservation = {
    progressId: input.progressId,
    targetVersion: input.targetVersion,
  }
  startReservation = reservation
  const now = Date.now()
  const active: UpdateJob = { progressId: input.progressId, targetVersion: input.targetVersion, phase: 'check', outcome: 'active', startedAt: now, updatedAt: now, phaseStartedAt: now, action: 'Checking the latest release and runtime compatibility', controller: new AbortController() }
  job = active
  const promise = persistJob(active).then(() => checkAndStartUpdate(input, active, restart)).catch(async (error: unknown) => {
    if (active.outcome === 'active') {
      active.previousPhase = active.phase
      active.phase = active.cancelRequested ? 'cancelled' : 'failed'
      active.outcome = active.cancelRequested ? 'cancelled' : 'failed'
      active.error = { code: error instanceof AppError ? error.code as ErrorCode : 'UPDATE_FAILED', message: active.cancelRequested ? 'Update cancelled; the current version is still running' : sanitizeUpdateError(error) }
      await persistJob(active).catch(() => undefined)
    }
    throw error
  })
  reservation.promise = promise
  try {
    return await promise
  } finally {
    if (startReservation === reservation) startReservation = null
  }
}
