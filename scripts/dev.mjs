import { spawn, spawnSync } from 'node:child_process'

// Why this exists: `pnpm --recursive --parallel run dev` deadlocks the
// `tsx watch` child on Windows (Node 24) — the supervised server process
// hangs during bootstrap before printing anything. Spawning the two
// package dev scripts directly avoids pnpm's concurrent stdio plumbing.

const targets = [
  ['server', ['--filter', '@bookdock/server', 'dev']],
  ['web', ['--filter', '@bookdock/web', 'dev']],
]

const children = targets.map(([name, args]) => {
  const child = spawn('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' })
  child.on('error', (err) => {
    console.error(`[dev] failed to start ${name}:`, err.message)
    shutdown(1)
  })
  child.on('exit', (code) => {
    shutdown(code ?? 1)
  })
  return child
})

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (child.exitCode !== null || child.killed) continue
    if (process.platform === 'win32') {
      // Node cannot kill a Windows process tree; taskkill /T can.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
