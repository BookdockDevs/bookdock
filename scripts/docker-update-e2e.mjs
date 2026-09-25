import { createHash } from 'node:crypto'
import { createServer } from 'node:https'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const fixtureRoot = '/e2e/fixtures'

function candidateSource(version, reportedVersion, mutateDatabase) {
  return `import { createServer } from 'node:http'
import { createRequire } from 'node:module'

const version = ${JSON.stringify(version)}
const reportedVersion = ${JSON.stringify(reportedVersion)}

if (${JSON.stringify(mutateDatabase)}) {
  const Database = createRequire('/app/apps/server/package.json')('better-sqlite3')
  const db = new Database('/data/bookdock.db')
  db.prepare("UPDATE e2e_marker SET value = 'mutated-by-failed-update'").run()
  db.close()
  console.log('e2e-candidate-mutated-database')
}

createServer((request, response) => {
  response.setHeader('content-type', 'application/json')
  if (request.url === '/api/v1/health') {
    response.end(JSON.stringify({ data: { ok: true } }))
    return
  }
  if (request.url === '/api/v1/internal/version') {
    if (!process.env.BOOKDOCK_LAUNCHER_NONCE || request.headers['x-bookdock-launcher-nonce'] !== process.env.BOOKDOCK_LAUNCHER_NONCE) {
      response.writeHead(404).end()
      return
    }
    response.end(JSON.stringify({ data: { version: reportedVersion } }))
    return
  }
  if (request.url === '/api/v1/system/update/status') {
    response.end(JSON.stringify({ data: { phase: 'idle', currentVersion: version } }))
    return
  }
  response.writeHead(404).end()
}).listen(3000, '0.0.0.0')
`
}

async function makeFixtures(factoryVersion, nodeMajor) {
  const require = createRequire('/app/apps/server/package.json')
  const JSZip = require('jszip')
  const [major, minor, patch] = factoryVersion.split('-')[0].split('.').map(Number)
  const commitVersion = `${major}.${minor}.${patch + 1}`
  const rollbackVersion = `${major}.${minor}.${patch + 2}`
  const scenarios = [
    { version: commitVersion, reportedVersion: commitVersion, mutateDatabase: false },
    { version: rollbackVersion, reportedVersion: factoryVersion, mutateDatabase: true },
  ]

  for (const scenario of scenarios) {
    const manifest = {
      version: scenario.version,
      nodeMajor,
      libc: 'musl',
      createdAt: Date.now(),
    }
    const zip = new JSZip()
    zip.file('release.json', `${JSON.stringify(manifest)}\n`)
    zip.file('apps/server/dist/index.js', candidateSource(scenario.version, scenario.reportedVersion, scenario.mutateDatabase))
    zip.file('apps/web/dist/index.html', '<!doctype html><title>Bookdock E2E candidate</title>')
    const archive = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
    const dir = path.join(fixtureRoot, scenario.version)
    await mkdir(dir, { recursive: true })
    const name = `bookdock-${scenario.version}-linux-x64-musl.zip`
    await writeFile(path.join(dir, 'release.json'), `${JSON.stringify(manifest)}\n`)
    await writeFile(path.join(dir, name), archive)
    await writeFile(path.join(dir, `${name}.sha256`), `${createHash('sha256').update(archive).digest('hex')}  ${name}\n`)
  }

  console.log(JSON.stringify({ commitVersion, rollbackVersion }))
}

async function serveMockGithub() {
  const version = process.env.E2E_TARGET_VERSION
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('E2E_TARGET_VERSION is invalid')
  const tag = `v${version}`
  const server = createServer({
    key: await readFile('/e2e/tls.key'),
    cert: await readFile('/e2e/tls.crt'),
  }, async (request, response) => {
    const requestPath = new URL(request.url ?? '/', 'https://github.com').pathname
    if (requestPath === '/repos/BookdockDevs/bookdock/releases/latest') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ tag_name: tag, html_url: `https://github.com/BookdockDevs/bookdock/releases/tag/${tag}`, published_at: '2026-09-23T00:00:00Z' }))
      return
    }

    const prefix = `/BookdockDevs/bookdock/releases/download/${tag}/`
    const assetName = requestPath.startsWith(prefix) ? requestPath.slice(prefix.length) : ''
    if (!['release.json', `bookdock-${version}-linux-x64-musl.zip`, `bookdock-${version}-linux-x64-musl.zip.sha256`].includes(assetName)) {
      response.writeHead(404).end('not found')
      return
    }

    try {
      const body = await readFile(path.join(fixtureRoot, version, assetName))
      response.writeHead(200, {
        'content-type': assetName === 'release.json' ? 'application/json' : 'application/octet-stream',
        'content-length': body.byteLength,
      })
      response.end(body)
    } catch {
      response.writeHead(404).end('not found')
    }
  })
  server.listen(443, '0.0.0.0', () => console.log(`Mock GitHub serving ${tag}`))
}

if (process.argv[2] === 'make-fixtures') {
  await mkdir(fixtureRoot, { recursive: true })
  await makeFixtures(process.argv[3], Number(process.argv[4]))
} else if (process.argv[2] === 'serve') {
  await serveMockGithub()
} else {
  throw new Error('Expected make-fixtures or serve')
}
