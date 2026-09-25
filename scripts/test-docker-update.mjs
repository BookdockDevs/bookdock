import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const image = process.argv[2] ?? 'bookdock:ci'
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bookdock-m4-'))
const fixtureRoot = path.join(tempRoot, 'fixtures')
const dataRoot = path.join(tempRoot, 'data')
const network = `bookdock-m4-${process.pid}-${randomUUID().slice(0, 8)}`
const scriptPath = fileURLToPath(new URL('./docker-update-e2e.mjs', import.meta.url))
const scriptCopy = path.join(tempRoot, 'docker-update-e2e.mjs')
const dockerUser = typeof process.getuid === 'function' && typeof process.getgid === 'function'
  ? `${process.getuid()}:${process.getgid()}`
  : null
const containers = new Set()
let networkCreated = false

function docker(args) {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join('\n')
    throw new Error(`docker ${args.join(' ')} failed${details ? `:\n${details}` : ''}`, { cause: error })
  }
}

function runNodeInImage(args) {
  return docker(['run', '--rm', ...(dockerUser ? ['--user', dockerUser] : []), '--volume', `${tempRoot}:/e2e`, '--workdir', '/app/apps/server', '--entrypoint', 'node', image, ...args])
}

async function waitFor(description, check, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`)
}

function requestJson(appName, route, options = {}, timeoutMs = 2_000) {
  const client = `
let input = ''
for await (const chunk of process.stdin) input += chunk
const { route, options, timeoutMs } = JSON.parse(input)
const response = await fetch('http://127.0.0.1:3000' + route, { ...options, signal: AbortSignal.timeout(timeoutMs) })
const body = await response.json().catch(() => null)
console.log(JSON.stringify({ status: response.status, ok: response.ok, body, cookie: response.headers.get('set-cookie') }))
`
  const output = execFileSync('docker', ['exec', '-i', appName, 'node', '--input-type=module', '-e', client], {
    encoding: 'utf8',
    input: JSON.stringify({ route, options, timeoutMs }),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return JSON.parse(output.trim())
}

function containerLogs(name) {
  const result = spawnSync('docker', ['logs', name], { encoding: 'utf8' })
  return [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim()
}

function startContainer(name, args) {
  docker(['run', '--detach', '--name', name, ...args])
  containers.add(name)
}

async function readMarker(appName) {
  const output = docker([
    'exec', '--workdir', '/app/apps/server', appName, 'node', '-e',
    "const Database = require('better-sqlite3'); const db = new Database('/data/bookdock.db', { readonly: true }); console.log(db.prepare('SELECT value FROM e2e_marker LIMIT 1').get().value); db.close()",
  ])
  return output.trim()
}

async function runScenario({ scenario, targetVersion, factoryVersion }) {
  const suffix = `${scenario}-${randomUUID().slice(0, 6)}`
  const githubName = `${network}-${suffix}-github`
  const appName = `${network}-${suffix}-app`
  const appData = path.join(dataRoot, scenario)
  await mkdir(appData, { recursive: true })

  startContainer(githubName, [
    '--network', network,
    '--network-alias', 'github.com',
    '--network-alias', 'api.github.com',
    '--env', `E2E_TARGET_VERSION=${targetVersion}`,
    '--volume', `${tempRoot}:/e2e:ro`,
    '--entrypoint', 'node',
    image,
    '/e2e/docker-update-e2e.mjs', 'serve',
  ])

  startContainer(appName, [
    '--network', network,
    ...(dockerUser ? ['--user', dockerUser] : []),
    '--env', 'NODE_EXTRA_CA_CERTS=/tmp/bookdock-e2e-tls.crt',
    '--mount', `type=bind,source=${path.join(tempRoot, 'tls.crt')},target=/tmp/bookdock-e2e-tls.crt,readonly`,
    '--mount', `type=bind,source=${appData},target=/data`,
    image,
  ])

  await waitFor(`${scenario} factory health endpoint`, async () => {
    const response = requestJson(appName, '/api/v1/health')
    return response.ok && response.body?.data?.ok === true
  }, 60_000).catch((error) => {
    throw new Error(`${error.message}\n${containerLogs(appName)}\n${containerLogs(githubName)}`)
  })

  const setup = requestJson(appName, '/api/v1/auth/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'e2e-owner', password: 'e2e-password-123' }),
  })
  assert.equal(setup.status, 200, JSON.stringify(setup.body))
  const setCookie = setup.cookie
  assert.ok(setCookie, 'setup response did not issue the owner cookie')
  const cookie = setCookie.split(';', 1)[0]

  docker([
    'exec', '--workdir', '/app/apps/server', appName, 'node', '-e',
    "const Database = require('better-sqlite3'); const db = new Database('/data/bookdock.db'); db.exec('CREATE TABLE e2e_marker (value TEXT NOT NULL)'); db.prepare('INSERT INTO e2e_marker (value) VALUES (?)').run('original'); db.close()",
  ])

  const start = requestJson(appName, '/api/v1/system/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ targetVersion, progressId: `e2e-${randomUUID()}` }),
  }, 20_000)
  assert.equal(start.status, 202, JSON.stringify(start.body))
  assert.equal(start.body?.data?.targetVersion, targetVersion)

  if (scenario === 'commit') {
    await waitFor(`${targetVersion} commit`, async () => {
      try {
        const response = requestJson(appName, '/api/v1/system/update/status', { headers: { cookie } })
        if (!response.ok || response.body?.data?.phase !== 'idle' || response.body?.data?.currentVersion !== targetVersion) return false
        const current = JSON.parse(await readFile(path.join(appData, 'releases', 'current'), 'utf8'))
        return current.name === targetVersion
      } catch {
        return false
      }
    })
    assert.equal(await readFile(path.join(appData, 'releases', 'pending')).then(() => true).catch(() => false), false)
    assert.match(containerLogs(appName), /launcher\.update_committed/)
    console.log(`PASS ${scenario}: downloaded ${targetVersion}, passed the version gate, and committed current`)
    return
  }

  await waitFor('failed candidate database mutation', async () => (await readMarker(appName)) === 'mutated-by-failed-update')
  await waitFor('launcher snapshot rollback', async () => containerLogs(appName).includes('launcher.update_reverted'))
  await waitFor('factory version after rollback', async () => {
    const response = requestJson(appName, '/api/v1/system/update/status', { headers: { cookie } })
    return response.ok && response.body?.data?.outcome === 'rolled-back' && response.body?.data?.currentVersion === factoryVersion
  })
  assert.equal(await readMarker(appName), 'original')
  assert.equal(await readFile(path.join(appData, 'releases', 'pending')).then(() => true).catch(() => false), false)
  assert.equal(await readFile(path.join(appData, 'releases', 'current')).then(() => true).catch(() => false), false)
  const logs = containerLogs(appName)
  assert.match(logs, /launcher\.update_reverted/)
  assert.doesNotMatch(logs, /launcher\.update_committed|launcher\.gate_abandoned/)
  assert.match(logs, new RegExp(`reported version ${factoryVersion.replaceAll('.', '\\.')}`))
  console.log(`PASS ${scenario}: rejected the wrong version fingerprint and restored the SQLite snapshot`)
}

async function removeScenarioContainers() {
  for (const name of [...containers]) {
    docker(['rm', '--force', name])
    containers.delete(name)
  }
}

async function main() {
  await mkdir(fixtureRoot, { recursive: true })
  await mkdir(dataRoot, { recursive: true })
  await writeFile(scriptCopy, await readFile(scriptPath))

  const opensslConfig = path.join(tempRoot, 'openssl.cnf')
  await writeFile(opensslConfig, [
    '[req]',
    'distinguished_name=dn',
    'x509_extensions=extensions',
    'prompt=no',
    '[dn]',
    'CN=github.com',
    '[extensions]',
    'basicConstraints=critical,CA:TRUE',
    'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
    'subjectAltName=DNS:github.com,DNS:api.github.com',
    '',
  ].join('\n'))
  execFileSync('openssl', ['req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '1', '-keyout', path.join(tempRoot, 'tls.key'), '-out', path.join(tempRoot, 'tls.crt'), '-config', opensslConfig], { stdio: 'pipe' })

  const factoryVersion = docker(['run', '--rm', '--entrypoint', 'node', image, '-e', "console.log(require('/app/release.json').version)"])
  assert.match(factoryVersion, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
  const { commitVersion, rollbackVersion } = JSON.parse(
    runNodeInImage(['/e2e/docker-update-e2e.mjs', 'make-fixtures', factoryVersion, '22']),
  )

  docker(['network', 'create', '--internal', network])
  networkCreated = true

  await runScenario({ scenario: 'commit', targetVersion: commitVersion, factoryVersion })
  await removeScenarioContainers()
  await runScenario({ scenario: 'rollback', targetVersion: rollbackVersion, factoryVersion })
}

try {
  await main()
  console.log('Docker update E2E passed (download, commit, failed gate, SQLite rollback)')
} catch (error) {
  console.error(error)
  for (const name of containers) console.error(`--- ${name} ---\n${containerLogs(name)}`)
  process.exitCode = 1
} finally {
  await removeScenarioContainers().catch((error) => console.error(error.message))
  if (networkCreated) docker(['network', 'rm', network])
  await rm(tempRoot, { recursive: true, force: true })
}
