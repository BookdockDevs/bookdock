import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLauncher, planLaunch } from './launcher.mjs'

const IDLE_EXIT = { code: 0, signal: null }
const SNAPSHOT_ID = '0.3.2-1760000000000'

function createWorkspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bookdock-launcher-'))
  const dataDir = path.join(root, 'data')
  const factoryRoot = path.join(root, 'app')
  const releasesDir = path.join(dataDir, 'releases')
  mkdirSync(releasesDir, { recursive: true })

  const writeAppRoot = (appRoot, version) => {
    mkdirSync(path.join(appRoot, 'apps', 'server', 'dist'), { recursive: true })
    writeFileSync(path.join(appRoot, 'apps', 'server', 'dist', 'index.js'), `// ${version}\n`)
    writeFileSync(path.join(appRoot, 'release.json'), JSON.stringify({ version }))
  }
  const writeRelease = (version) => {
    const dir = path.join(releasesDir, version)
    writeAppRoot(dir, version)
    return dir
  }

  writeAppRoot(factoryRoot, '0.3.2')
  return {
    root,
    dataDir,
    factoryRoot,
    dbPath: path.join(dataDir, 'bookdock.db'),
    writeRelease,
    releaseDir: (version) => path.join(releasesDir, version),
    pointerPath: (name) => path.join(releasesDir, name),
    writePointer: (name, value) => writeFileSync(path.join(releasesDir, name), JSON.stringify(value)),
    readPointer: (name) => JSON.parse(readFileSync(path.join(releasesDir, name), 'utf8')),
    seedSnapshot(snapshotId) {
      const dir = path.join(dataDir, 'snapshots', snapshotId)
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, 'bookdock.db'), `snapshot:${snapshotId}`)
    },
    /** Stage a promoted-but-unhealthy update: pending marker + target + rollback seats. */
    stageUpdate({ target = '0.4.0', previous, snapshot = SNAPSHOT_ID } = {}) {
      const dir = this.writeRelease(target)
      if (previous) this.writePointer('current', { name: previous })
      if (snapshot) {
        this.seedSnapshot(snapshot)
        writeFileSync(this.dbPath, 'live-database')
      }
      this.writePointer('pending', { target, snapshot, progressId: 'progress-1' })
      writeFileSync(path.join(releasesDir, 'update-state.json'), JSON.stringify({ progressId: 'progress-1', targetVersion: target, phase: 'restarting', outcome: 'active', startedAt: 1 }))
      return { dir, target, snapshot }
    },
    dispose() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * Stands in for the supervised server child. `versions` is what the child answers
 * the version probe with, cycling once and then sticking to the last value, so a
 * one-element list models a child that never changes its answer.
 */
function createChild(versions = []) {
  const emitter = new EventEmitter()
  let probes = 0
  return {
    exited: new Promise((resolve) => emitter.once('exit', resolve)),
    kill: () => emitter.emit('exit', { code: null, signal: 'SIGTERM' }),
    exit: (code) => emitter.emit('exit', { code, signal: null }),
    idle: () => emitter.emit('exit', IDLE_EXIT),
    probe: () => (versions.length ? versions[Math.min(probes++, versions.length - 1)] : null),
  }
}

let workspace

beforeEach(() => {
  workspace = createWorkspace()
})

afterEach(() => {
  workspace.dispose()
})

/**
 * A launcher that never waits in wall-clock time: `sleep` only yields, so every
 * gate below is bounded by its probe answers rather than by the 90 s default.
 */
function launcherFor(spawn, options = {}) {
  const launches = []
  let current = null
  const launcher = createLauncher({
    dataDir: workspace.dataDir,
    dbPath: workspace.dbPath,
    factoryRoot: workspace.factoryRoot,
    nonce: 'test-nonce',
    log: () => {},
    error: () => {},
    sleep: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
    probe: async () => current?.probe() ?? null,
    startChild: (appRoot) => {
      launches.push(appRoot)
      current = spawn(appRoot, launches.length)
      return current
    },
    ...options,
  })
  return { launcher, launches }
}

describe('planLaunch', () => {
  it('runs the factory image when the volume holds no release', () => {
    expect(planLaunch({ dataDir: workspace.dataDir, factoryRoot: workspace.factoryRoot })).toEqual({
      appRoot: workspace.factoryRoot,
    })
  })

  it('keeps running the volume release the panel updated to', () => {
    const dir = workspace.writeRelease('0.4.0')
    workspace.writePointer('current', { name: '0.4.0' })

    expect(planLaunch({ dataDir: workspace.dataDir, factoryRoot: workspace.factoryRoot })).toEqual({ appRoot: dir })
  })

  it('lets a newer pulled image win over an older volume release', () => {
    workspace.writeRelease('0.4.0')
    workspace.writePointer('current', { name: '0.4.0' })
    writeFileSync(path.join(workspace.factoryRoot, 'release.json'), JSON.stringify({ version: '0.10.0' }))

    expect(planLaunch({ dataDir: workspace.dataDir, factoryRoot: workspace.factoryRoot })).toEqual({
      appRoot: workspace.factoryRoot,
    })
  })

  it('gates the pending release before the pointer rules apply', () => {
    const { dir, target, snapshot } = workspace.stageUpdate({ target: '0.4.0' })

    expect(planLaunch({ dataDir: workspace.dataDir, factoryRoot: workspace.factoryRoot })).toEqual({
      appRoot: dir,
      pending: { target, snapshot, progressId: 'progress-1' },
    })
  })

  it('asks for a rollback when the pending release is not launchable', () => {
    workspace.seedSnapshot(SNAPSHOT_ID)
    workspace.writePointer('pending', { target: '0.4.0', snapshot: SNAPSHOT_ID, progressId: 'progress-1' })

    expect(planLaunch({ dataDir: workspace.dataDir, factoryRoot: workspace.factoryRoot })).toMatchObject({
      rollback: { target: '0.4.0' },
    })
  })

  it('gates a prerelease pending target', () => {
    const { dir, target, snapshot } = workspace.stageUpdate({ target: '0.4.0-beta.1' })

    expect(planLaunch({ dataDir: workspace.dataDir, factoryRoot: workspace.factoryRoot })).toEqual({
      appRoot: dir,
      pending: { target, snapshot, progressId: 'progress-1' },
    })
  })

  it('keeps a stable volume release when a prerelease of the same core is pulled', () => {
    const dir = workspace.writeRelease('0.4.0')
    workspace.writePointer('current', { name: '0.4.0' })
    writeFileSync(path.join(workspace.factoryRoot, 'release.json'), JSON.stringify({ version: '0.4.0-beta.2' }))

    expect(planLaunch({ dataDir: workspace.dataDir, factoryRoot: workspace.factoryRoot })).toEqual({ appRoot: dir })
  })

  it('drops a current pointer whose release directory is gone', () => {
    workspace.writePointer('current', { name: '0.4.0' })

    expect(planLaunch({ dataDir: workspace.dataDir, factoryRoot: workspace.factoryRoot })).toEqual({
      appRoot: workspace.factoryRoot,
    })
    expect(existsSync(workspace.pointerPath('current'))).toBe(false)
  })
})

describe('launcher update gate', () => {
  it('commits a pending release that reports its own version', async () => {
    const { dir, target } = workspace.stageUpdate({ previous: '0.3.5' })
    workspace.writeRelease('0.3.5')
    const child = createChild([target])
    const { launcher, launches } = launcherFor(() => child)

    const running = launcher.run()
    await vi.waitFor(() => expect(workspace.readPointer('current')).toEqual({ name: target }))

    expect(launches).toEqual([dir])
    expect(workspace.readPointer('previous')).toEqual({ name: '0.3.5' })
    expect(existsSync(workspace.pointerPath('pending'))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(path.dirname(workspace.pointerPath('pending')), 'update-state.json'), 'utf8'))).toMatchObject({ outcome: 'succeeded', targetVersion: target })
    // Commit must not touch the data: the snapshot stays as the rollback seat.
    expect(readFileSync(workspace.dbPath, 'utf8')).toBe('live-database')
    expect(existsSync(path.join(workspace.dataDir, 'snapshots', SNAPSHOT_ID))).toBe(true)

    child.idle()
    launcher.stop()
    await running
  })

  it('reverts code and data when the child reports the old version', async () => {
    workspace.stageUpdate({ previous: '0.3.5' })
    const previous = workspace.writeRelease('0.3.5')
    // A release from the commit before that: a revert must not go back this far.
    workspace.writeRelease('0.3.0')
    workspace.writePointer('previous', { name: '0.3.0' })
    // The new child answers with the old version — the case the version
    // fingerprint exists for, which a liveness-only probe would pass.
    const { launcher, launches } = launcherFor(() => createChild(['0.3.5']))

    const running = launcher.run()
    await vi.waitFor(() => expect(readFileSync(workspace.dbPath, 'utf8')).toBe(`snapshot:${SNAPSHOT_ID}`))

    // `current` already named the serving release, so the revert leaves it alone.
    expect(workspace.readPointer('current')).toEqual({ name: '0.3.5' })
    expect(workspace.readPointer('previous')).toEqual({ name: '0.3.0' })
    expect(existsSync(workspace.pointerPath('pending'))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(path.dirname(workspace.pointerPath('pending')), 'update-state.json'), 'utf8'))).toMatchObject({ outcome: 'rolled-back', phase: 'failed' })
    // After the revert the launcher settles on the restored release.
    await vi.waitFor(() => expect(launches[1]).toBe(previous))

    launcher.stop()
    await running
  })

  it('reverts to the factory image when nothing has been committed yet', async () => {
    workspace.stageUpdate()
    const { launcher, launches } = launcherFor(() => createChild(['0.3.5']))

    const running = launcher.run()
    await vi.waitFor(() => expect(readFileSync(workspace.dbPath, 'utf8')).toBe(`snapshot:${SNAPSHOT_ID}`))

    expect(existsSync(workspace.pointerPath('current'))).toBe(false)
    await vi.waitFor(() => expect(launches[1]).toBe(workspace.factoryRoot))

    launcher.stop()
    await running
  })

  it('restarts the child while waiting for the pending release to answer', async () => {
    const { target } = workspace.stageUpdate()
    const crash = createChild()
    const recovered = createChild([null, null, target])
    const { launcher, launches } = launcherFor((_appRoot, attempt) => (attempt === 1 ? crash : recovered))

    const running = launcher.run()
    crash.exit(1)
    await vi.waitFor(() => expect(launches.length).toBeGreaterThan(1))
    await vi.waitFor(() => expect(workspace.readPointer('current')).toEqual({ name: target }))

    recovered.idle()
    launcher.stop()
    await running
  })

  it('refuses to revert without a restorable snapshot and leaves the state for an operator', async () => {
    const { target } = workspace.stageUpdate({ previous: '0.3.5' })
    workspace.writePointer('pending', { target, snapshot: null, progressId: 'progress-1' })
    const refusals = []
    const { launcher } = launcherFor(() => createChild(['0.3.5']), {
      error: (message) => {
        refusals.push(message)
      },
    })

    const running = launcher.run()
    await vi.waitFor(() => expect(refusals).toContain('launcher.rollback_refused'))
    launcher.stop()
    await running

    // Refusing must not half-revert: pending stays and the pointers are untouched.
    expect(existsSync(workspace.pointerPath('pending'))).toBe(true)
    expect(workspace.readPointer('current')).toEqual({ name: '0.3.5' })
    expect(readFileSync(workspace.dbPath, 'utf8')).toBe('live-database')
  })

  it('drops a pending marker it can neither boot nor undo, so a server still comes up', async () => {
    // The staged release is missing its bundle and there is no snapshot to
    // restore: keeping the marker would mean no server ever starts.
    workspace.seedSnapshot(SNAPSHOT_ID)
    workspace.writePointer('current', { name: '0.3.5' })
    workspace.writeRelease('0.3.5')
    workspace.writePointer('pending', { target: '0.4.0', snapshot: null, progressId: 'progress-1' })
    const child = createChild()
    const { launcher, launches } = launcherFor(() => child)

    const running = launcher.run()
    await vi.waitFor(() => expect(launches).toEqual([workspace.releaseDir('0.3.5')]))
    expect(existsSync(workspace.pointerPath('pending'))).toBe(false)

    child.idle()
    launcher.stop()
    await running
  })

  it('prunes releases beyond current and previous after a commit', async () => {
    const { target } = workspace.stageUpdate({ previous: '0.3.5' })
    workspace.writeRelease('0.3.5')
    const stale = workspace.writeRelease('0.2.0')
    const child = createChild([target])
    const { launcher } = launcherFor(() => child)

    const running = launcher.run()
    await vi.waitFor(() => expect(existsSync(stale)).toBe(false))
    expect(existsSync(workspace.releaseDir(target))).toBe(true)
    expect(existsSync(workspace.releaseDir('0.3.5'))).toBe(true)

    child.idle()
    launcher.stop()
    await running
  })
})

describe('launcher supervision', () => {
  it('re-resolves the release when the server exits for an update restart', async () => {
    const target = workspace.writeRelease('0.4.0')
    const first = createChild()
    const second = createChild()
    const { launcher, launches } = launcherFor((_appRoot, attempt) => (attempt === 1 ? first : second))

    const running = launcher.run()
    await vi.waitFor(() => expect(launches).toEqual([workspace.factoryRoot]))

    workspace.writePointer('current', { name: '0.4.0' })
    first.exit(75)
    await vi.waitFor(() => expect(launches).toEqual([workspace.factoryRoot, target]))

    second.idle()
    launcher.stop()
    await running
  })

  it('restarts a plain crash on the same release after the restart delay', async () => {
    const first = createChild()
    const second = createChild()
    const delays = []
    const { launcher, launches } = launcherFor((_appRoot, attempt) => (attempt === 1 ? first : second), {
      sleep: async (ms) => {
        delays.push(ms)
        await new Promise((resolve) => setImmediate(resolve))
      },
      restartDelayMs: 2000,
    })

    const running = launcher.run()
    await vi.waitFor(() => expect(launches).toHaveLength(1))
    first.exit(1)
    await vi.waitFor(() => expect(launches).toHaveLength(2))
    expect(delays).toContain(2000)

    second.idle()
    launcher.stop()
    await running
  })
})
