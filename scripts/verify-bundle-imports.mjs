// Verifies a panel-updater artifact can resolve every production import
// after its node_modules symlinks are flattened.
//
// Background: pnpm keeps transitive dependencies inside its store directory
// (node_modules/.pnpm), reachable only through symlinks. The updater bundle
// is zipped with symlinks dereferenced and extracted with jszip, so every
// package becomes a real directory and sibling resolution through the store
// stops working. sharp 0.35 broke the 0.3.6 panel update exactly this way:
// dist/colour.mjs imports @img/colour, which lived only in the store, so the
// staged server crashed on startup with ERR_MODULE_NOT_FOUND while the
// Docker image (symlinks preserved) kept working. The same flattening also
// breaks jszip (pako/setimmediate/...) and iconv-lite (safer-buffer): the
// 0.3.6 log only shows sharp because its import statement evaluates first.
//
// The check mirrors Node resolution without executing anything (the bundle
// targets musl and cannot boot on the glibc CI runner):
//   1. the server entry exists (mirrors update.service's own check),
//   2. starting from dist's bare imports, every file-reachable bare import
//      that the owning package declares in `dependencies` (or in a *musl*
//      optionalDependency, i.e. the native prebuild axis) resolves through
//      a plain upward node_modules walk in the staged tree.
// Skipped by design: relative/builtin imports, `optionalDependencies`
// without musl in the name (guarded or platform-irrelevant), browser-only
// bundles unreachable from the entry closure, and imports hidden inside
// comments (only full-line // and block comments are stripped).
//
// Usage: node scripts/verify-bundle-imports.mjs <artifact-zip>
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// Same extractor library the production updater uses.
const JSZip = createRequire(path.join(here, '..', 'apps', 'server', 'package.json'))('jszip')

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.replace(/^node:/, '')]))
const FROM_IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /(?:require|import)\(\s*['"]([^'"]+)['"]/g

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

function pkgName(spec) {
  const bare = spec.startsWith('node:') ? spec.slice(5) : spec
  if (bare.startsWith('.') || BUILTINS.has(bare) || BUILTINS.has(spec)) return null
  const parts = bare.split('/')
  return bare.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

async function existsAsync(p) {
  try {
    await readFile(p)
    return true
  } catch {
    return false
  }
}

async function locatePackage(topRoot, fromDir, name) {
  let current = fromDir
  for (;;) {
    const candidate = path.join(current, 'node_modules', name, 'package.json')
    if (await existsAsync(candidate)) return path.dirname(candidate)
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
    if (current.length < topRoot.length - 1) return null
  }
}

function entryFile(manifest) {
  const candidates = []
  if (typeof manifest.main === 'string') candidates.push(manifest.main)
  if (typeof manifest.module === 'string') candidates.push(manifest.module)
  const exp = manifest.exports?.['.']
  const fromExports = typeof exp === 'string' ? exp : exp?.import ?? exp?.require ?? exp?.default
  if (typeof fromExports === 'string') candidates.push(fromExports)
  candidates.push('index.js')
  return candidates
}

async function resolveRelative(baseFile, spec) {
  const base = path.resolve(path.dirname(baseFile), spec)
  const tries = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, path.join(base, 'index.js'), path.join(base, 'index.mjs')]
  for (const t of tries) {
    if (await existsAsync(t)) return t
  }
  return null
}

async function collectFileImports(pkgDir, entryRelPaths) {
  const specs = new Map()
  const record = (spec, rel) => {
    const name = pkgName(spec)
    if (!name) return
    if (!specs.has(name)) specs.set(name, [])
    specs.get(name).push(rel)
  }
  const seenFiles = new Set()
  const queue = [...entryRelPaths]
  while (queue.length > 0) {
    const rel = queue.shift()
    const full = path.join(pkgDir, rel)
    if (seenFiles.has(full)) continue
    seenFiles.add(full)
    let code
    try {
      code = await readFile(full, 'utf8')
    } catch {
      continue
    }
    const stripped = stripComments(code)
    for (const re of [FROM_IMPORT_RE, BARE_IMPORT_RE]) {
      for (const m of stripped.matchAll(re)) {
        const spec = m[1]
        if (spec.startsWith('.')) {
          const resolved = await resolveRelative(full, spec)
          if (resolved) queue.push(path.relative(pkgDir, resolved))
          continue
        }
        record(spec, rel)
      }
    }
  }
  return specs
}

async function extractZip(zipPath, dest) {
  const zip = await JSZip.loadAsync(await readFile(zipPath))
  const writes = []
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return
    // Same traversal guard as the production extractor: nothing may escape.
    const target = path.normalize(path.join(dest, relativePath))
    if (!target.startsWith(dest + path.sep)) throw new Error(`Archive entry escapes the stage dir: ${relativePath}`)
    writes.push(entry.async('nodebuffer').then(async (data) => {
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, data)
    }))
  })
  await Promise.all(writes)
}

async function main() {
  const [zipPath] = process.argv.slice(2)
  if (!zipPath) throw new Error('Usage: node scripts/verify-bundle-imports.mjs <artifact-zip>')
  const stage = await mkdtemp(path.join(os.tmpdir(), 'bookdock-bundle-verify-'))
  try {
    await extractZip(zipPath, stage)
    const failures = []
    const serverRoot = path.join(stage, 'apps', 'server')
    let bundleArch = 'x64'
    try {
      const release = JSON.parse(await readFile(path.join(stage, 'release.json'), 'utf8'))
      if (typeof release.arch === 'string' && release.arch) bundleArch = release.arch
    } catch {
      // Fixture zips carry no manifest; fall back to x64.
    }
    const distEntry = path.join(serverRoot, 'dist', 'index.js')
    if (!(await existsAsync(distEntry))) failures.push('server entry missing: apps/server/dist/index.js')

    const reached = new Map()
    const queue = []
    if (await existsAsync(distEntry)) {
      for (const [name, locs] of await collectFileImports(serverRoot, ['dist/index.js'])) {
        queue.push({ name, from: `dist/index.js (${locs[0]})` })
      }
    }
    let packageCount = 0
    while (queue.length > 0) {
      const { name, from } = queue.shift()
      if (reached.has(name)) continue
      const dir = await locatePackage(stage, path.join(serverRoot, 'dist'), name)
      if (!dir) {
        failures.push(`${from} -> ${name}`)
        reached.set(name, null)
        continue
      }
      reached.set(name, dir)
      packageCount += 1
      packageCount += 1
      let manifest
      try {
        manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
      } catch {
        continue
      }
      const declared = new Set(Object.keys(manifest.dependencies ?? {}))
      // Musl platform prebuilds are probed per architecture by loaders like
      // sharp's; only the artifact's own arch can ever be staged (read from
      // the release manifest when present, x64 otherwise).
      const musl = new Set(
        Object.keys(manifest.optionalDependencies ?? {}).filter((d) => d.includes('musl') && d.includes(bundleArch)),
      )
      // Parse every resolving entry candidate (main + module + exports):
      // packages like sharp split CJS/ESM entries and the first hit is not
      // necessarily the runtime one; extensionless mains (jszip's ./lib/index)
      // resolve through the same relative rules as imports.
      const fileSpecs = new Map()
      for (const entryRel of entryFile(manifest)) {
        const entryFull = await resolveRelative(path.join(dir, '_'), `./${entryRel}`)
        if (!entryFull) continue
        for (const [spec, locs] of await collectFileImports(dir, [path.relative(dir, entryFull)])) {
          if (!fileSpecs.has(spec)) fileSpecs.set(spec, locs[0])
        }
      }
      // A file-evidenced musl require proves the package probes platforms
      // (sharp loads its binding and libvips through platform-suffixed
      // names, partly via template strings no static scan can see), so the
      // whole arch-matching musl set becomes required, not just the names
      // spelled out statically.
      const probesMusl = [...fileSpecs.keys()].some((spec) => musl.has(spec))
      for (const [spec, loc] of fileSpecs) {
        if (declared.has(spec) || musl.has(spec)) queue.push({ name: spec, from: `${name} (${loc})` })
      }
      if (probesMusl) {
        for (const spec of musl) queue.push({ name: spec, from: `${name} (platform probe)` })
      }
    }
    if (failures.length > 0) {
      console.error(`Unresolvable imports in flattened bundle (${failures.length}):\n${failures.join('\n')}`)
      process.exitCode = 1
      return
    }
    console.log(`Bundle import closure OK (${packageCount} packages checked)`)
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

await main()
