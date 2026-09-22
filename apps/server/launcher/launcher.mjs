// Bookdock container entry point (PID 1).
//
// Runs the server child, and — while an in-panel update is pending — decides
// whether that update commits or rolls back. Deliberately dependency-free and
// deliberately not updatable from the panel: it ships only with images.
// Contract: docs/local/adr/0025-launcher-volume-releases-self-update.md
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SERVER_ENTRY = path.join('apps', 'server', 'dist', 'index.js')
const MANIFEST_FILE = 'release.json'
const RESTART_FOR_UPDATE = 75
const GATE_TIMEOUT_MS = 90_000
const GATE_INTERVAL_MS = 1_000
const RESTART_DELAY_MS = 2_000
const PROBE_TIMEOUT_MS = 2_000

/**
 * Accepts `x.y.z` and `x.y.z-tag`, but only the numeric core is returned: tags
 * never order releases, so pulling a prerelease image over a volume holding the
 * same core keeps the volume instead of replacing a stable install with its own
 * pre-release. The anchored pattern doubles as the traversal guard on release names.
 */
function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(value.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** A launchable app root has a readable version manifest and a server bundle. */
function releaseVersion(appRoot) {
  const parts = parseVersion(readJson(path.join(appRoot, MANIFEST_FILE))?.version)
  return parts && existsSync(path.join(appRoot, SERVER_ENTRY)) ? parts : null
}

/**
 * Which app root to run, and whether that start owes a health gate.
 * `pending` outranks the pointer rules; otherwise the image wins whenever its
 * factory version is strictly newer, so `docker compose pull` never loses.
 */
export function planLaunch({ dataDir, factoryRoot, log = () => {} }) {
  const releasesDir = path.join(dataDir, 'releases')
  const pending = readJson(path.join(releasesDir, 'pending'))
  const pendingTarget = typeof pending?.target === 'string' ? parseVersion(pending.target) : null

  if (pendingTarget) {
    const appRoot = path.join(releasesDir, pending.target)
    return releaseVersion(appRoot)
      ? { appRoot, pending }
      : { rollback: pending, reason: `pending release ${pending.target} is not launchable` }
  }

  const current = readJson(path.join(releasesDir, 'current'))
  let volume = null
  if (typeof current?.name === 'string') {
    const appRoot = path.join(releasesDir, current.name)
    if (releaseVersion(appRoot)) volume = appRoot
    else {
      rmSync(path.join(releasesDir, 'current'), { force: true })
      log('launcher.pointer_dropped', { pointer: 'current', name: current.name })
    }
  }

  const factory = releaseVersion(factoryRoot)
  if (volume && (!factory || compareVersions(factory, releaseVersion(volume)) <= 0)) return { appRoot: volume }
  return { appRoot: factoryRoot }
}

export function createLauncher({
  dataDir = process.env.DATA_DIR ?? '/data',
  dbPath = process.env.DB_PATH ?? path.join(dataDir, 'bookdock.db'),
  factoryRoot = process.env.BOOKDOCK_FACTORY_ROOT ?? '/app',
  port = Number(process.env.PORT ?? 3000),
  nonce = randomUUID(),
  log = (message, extra) => console.log(JSON.stringify({ msg: message, ...extra })),
  error = (message, extra) => console.error(JSON.stringify({ msg: message, ...extra })),
  startChild,
  stopChild,
  probe,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  gateTimeoutMs = GATE_TIMEOUT_MS,
  gateIntervalMs = GATE_INTERVAL_MS,
  restartDelayMs = RESTART_DELAY_MS,
} = {}) {
  const releasesDir = path.join(dataDir, 'releases')
  const pointerPath = (name) => path.join(releasesDir, name)
  const readPointer = (name) => readJson(pointerPath(name))
  /** Pointers are single-line files whose contents name a release; rename makes the swap atomic. */
  function writePointer(name, value) {
    mkdirSync(releasesDir, { recursive: true })
    const file = pointerPath(name)
    const tmp = `${file}.${randomUUID()}.tmp`
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
    renameSync(tmp, file)
  }
  let stopping = false
  let running = null

  function spawnChild(appRoot) {
    const launched = startChild
      ? startChild(appRoot)
      : spawn(process.execPath, [path.join(appRoot, SERVER_ENTRY)], {
          cwd: appRoot,
          env: { ...process.env, BOOKDOCK_LAUNCHER_NONCE: nonce },
          stdio: 'inherit',
        })
    const child = { handle: launched, done: false }
    child.exited = Promise.resolve(launched.exited ?? new Promise((resolve) => launched.once('exit', (code, signal) => resolve({ code, signal })))).then((exit) => {
      child.done = true
      child.exit = exit
      return exit
    })
    return child
  }

  async function stopRunning() {
    const child = running
    if (!child || child.done) return
    child.done = true
    try {
      if (stopChild) stopChild(child.handle)
      else child.handle.kill('SIGTERM')
    } catch {}
    await child.exited
  }

  /** Liveness answers "something is up"; the fingerprint answers "is it the new code". */
  async function probeVersion() {
    if (probe) return probe()
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (!health.ok || (await health.json().catch(() => null))?.data?.ok !== true) return null
      const info = await fetch(`http://127.0.0.1:${port}/api/v1/internal/version`, {
        headers: { 'x-bookdock-launcher-nonce': nonce },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      const version = info.ok ? (await info.json().catch(() => null))?.data?.version : null
      return typeof version === 'string' ? version : null
    } catch {
      return null
    }
  }

  function restoreSnapshot(snapshotId) {
    const source = path.join(dataDir, 'snapshots', snapshotId, 'bookdock.db')
    if (!existsSync(source)) throw new Error(`snapshot ${snapshotId} has no ${source}`)
    copyFileSync(source, dbPath)
    for (const sidecar of ['-wal', '-shm']) rmSync(`${dbPath}${sidecar}`, { force: true })
  }

  /**
   * Code and data move back together: reverting the code alone would run the old
   * app against an already-migrated database, which is the state ADR-25 exists
   * to avoid, so a rollback without a restorable snapshot is refused instead.
   *
   * `current` needs no touching: it still names the release that served before
   * the update, because only a gate success moves it. Dropping `pending` is what
   * puts the launcher back on it. Returns whether the revert happened.
   */
  function rollback(pending, reason) {
    if (!pending?.snapshot) {
      error('launcher.rollback_refused', { target: pending?.target, reason, detail: 'no snapshot to restore' })
      return false
    }
    try {
      restoreSnapshot(pending.snapshot)
    } catch (err) {
      error('launcher.rollback_refused', { target: pending?.target, reason, detail: err.message })
      return false
    }
    rmSync(pointerPath('pending'), { force: true })
    error('launcher.update_reverted', { target: pending?.target, reason, database: `restored from ${pending.snapshot}` })
    return true
  }

  /** The volume holds at most two releases; the image copy is the third rollback target. */
  function pruneReleases(keepNames) {
    if (!existsSync(releasesDir)) return
    for (const entry of readdirSync(releasesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || keepNames.has(entry.name) || !releaseVersion(path.join(releasesDir, entry.name))) continue
      rmSync(path.join(releasesDir, entry.name), { recursive: true, force: true })
      log('launcher.release_pruned', { version: entry.name })
    }
  }

  function commit(pending) {
    const previous = readPointer('current')?.name
    if (typeof previous === 'string' && previous !== pending.target) writePointer('previous', { name: previous })
    writePointer('current', { name: pending.target })
    rmSync(pointerPath('pending'), { force: true })
    pruneReleases(new Set([pending.target, readPointer('previous')?.name]))
    log('launcher.update_committed', { version: pending.target })
  }

  /** Restart the child on the pending release until it reports the expected version. */
  async function gate(appRoot, pending) {
    const deadline = Date.now() + gateTimeoutMs
    log('launcher.update_gating', { target: pending.target, appRoot })
    while (!stopping && Date.now() < deadline) {
      if (running.done) {
        log('launcher.child_restarted_during_gate', { target: pending.target })
        running = spawnChild(appRoot)
      }
      await sleep(gateIntervalMs)
      const reported = await probeVersion()
      if (!reported) continue
      if (reported !== pending.target) return { ok: false, detail: `reported version ${reported}` }
      commit(pending)
      return { ok: true }
    }
    return { ok: false, detail: stopping ? 'launcher shutting down' : `no healthy response within ${gateTimeoutMs}ms` }
  }

  function stop() {
    if (stopping) return
    stopping = true
    log('launcher.stop_requested')
    stopRunning()
  }

  return {
    stop,

    async run() {
      for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
        log(`launcher.${signal.toLowerCase()}_received`)
        stop()
      })

      // A rollback that cannot restore a snapshot is not retryable: gating the
      // same release again would restart the child every cycle forever, so the
      // launcher runs it ungated and says so.
      let ungated = null

      while (!stopping) {
        const plan = planLaunch({ dataDir, factoryRoot, log })
        if (plan.rollback) {
          // Nothing can boot from this marker, so keeping it means no server at
          // all; the marker is dropped and the pointers decide the next start.
          if (!rollback(plan.rollback, plan.reason)) {
            rmSync(pointerPath('pending'), { force: true })
            error('launcher.pending_dropped', { target: plan.rollback.target, reason: plan.reason })
          }
          await sleep(restartDelayMs)
          continue
        }

        log('launcher.start', { appRoot: plan.appRoot })
        running = spawnChild(plan.appRoot)

        if (plan.pending && plan.pending.target !== ungated) {
          const result = await gate(plan.appRoot, plan.pending)
          if (!result.ok) {
            if (stopping) break
            await stopRunning()
            if (rollback(plan.pending, result.detail)) {
              await sleep(restartDelayMs)
              continue
            }
            ungated = plan.pending.target
            error('launcher.gate_abandoned', {
              target: ungated,
              reason: result.detail,
              detail: 'no rollback available, running unrecovered update',
            })
          }
        }

        const exit = await running.exited
        if (stopping) break
        if (exit?.code === RESTART_FOR_UPDATE) {
          log('launcher.restart_requested')
          continue
        }
        log('launcher.child_exited', { code: exit?.code, signal: exit?.signal })
        await sleep(restartDelayMs)
      }
      await stopRunning()
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await createLauncher().run()
}
