// Emits the release metadata that both the launcher (factory copy inside the
// image) and the panel updater (artifact copy on GitHub releases) read.
// Must run inside the Linux build stage so `nodeMajor` and `libc` describe the
// runtime the release artifact is built for, not the developer machine.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function argOut() {
  const index = process.argv.indexOf('--out')
  if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: release-manifest.mjs --out <file>')
  return process.argv[index + 1]
}

function detectLibc() {
  if (process.platform !== 'linux') return process.platform
  const header = process.report.getReport()?.header
  return typeof header?.glibcVersionRuntime === 'string' && header.glibcVersionRuntime.length > 0 ? 'glibc' : 'musl'
}

const version = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Unsupported release version: ${version}`)

const manifest = {
  version,
  nodeMajor: Number(process.versions.node.split('.')[0]),
  libc: detectLibc(),
  arch: process.arch,
  createdAt: Date.now(),
}

const out = path.resolve(argOut())
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`wrote ${out}: ${manifest.version} node${manifest.nodeMajor} ${manifest.libc}`)
