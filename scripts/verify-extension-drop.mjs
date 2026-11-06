import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyUploads } from './lib/extension-upload-acceptance.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const scratch = path.join(root, '.tmp', 'extension-probe')
const baseUrl = 'http://127.0.0.1:19423'
const defaultBrowser = path.join(root, '.tmp/chrome-testing/chrome-win64/chrome.exe')
const browserPath = process.env.BOOKDOCK_PROBE_BROWSER ?? await access(defaultBrowser).then(() => defaultBrowser, () => 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const connections = []
const require = createRequire(new URL('../apps/server/package.json', import.meta.url))
const JSZip = require('jszip')
await mkdir(scratch, { recursive: true })
const serverData = path.join(scratch, `server-${Date.now()}`)
const serverProcess = spawn(process.execPath, ['--import', './node_modules/tsx/dist/loader.mjs', 'src/index.ts'], {
  cwd: path.join(root, 'apps/server'),
  env: { ...process.env, DATA_DIR: serverData, DB_PATH: path.join(serverData, 'bookdock.db'), PORT: '19423', LOG_LEVEL: 'warn' },
  windowsHide: true,
  stdio: 'ignore',
})

async function until(fn, label, timeout = 30_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const result = await fn().catch(() => null)
    if (result) return result
    await wait(200)
  }
  throw new Error(`Timed out: ${label}`)
}

async function cdp(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  const errors = []
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((argument) => argument.description ?? argument.value).join(' '))
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(timer)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    }
  }
  const client = {
    socket,
    errors,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 60_000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    async evaluate(expression) {
      const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
      return response.result.value
    },
  }
  connections.push(client)
  return client
}

async function api(route, body, cookie, method = 'POST') {
  const response = await fetch(baseUrl + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
  const json = await response.json()
  assert.ok(response.ok, `${route}: ${JSON.stringify(json)}`)
  return { data: json.data, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}

const requests = new Map()
const failNames = new Set()
const controls = { delay: 0 }
const host = createServer(async (request, response) => {
  if (request.url.startsWith('/drop-target/')) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><title>Drop target</title><body style="height:100vh"><h1>Drop target</h1><input type="file"><script>window.siteDrops=0;window.addEventListener("dragover",e=>e.preventDefault());window.addEventListener("drop",e=>{window.siteDrops++;e.preventDefault()})</script></body></html>')
    return
  }
  const parts = []
  for await (const part of request) parts.push(part)
  const body = Buffer.concat(parts)
  if (request.method === 'POST' && request.url === '/api/v1/ext/books') {
    const name = /filename="([^"]+)"/.exec(body.toString('latin1'))?.[1]
    if (name) requests.set(name, (requests.get(name) ?? 0) + 1)
    if (failNames.delete(name)) { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{"error":{"code":"PROBE_FAILURE"}}'); return }
    if (controls.delay) await wait(controls.delay)
  }
  try {
    const headers = Object.fromEntries(['content-type', 'authorization', 'cookie'].filter(key=>request.headers[key]).map(key=>[key,request.headers[key]]))
    const forwarded = await fetch(baseUrl + request.url, { method: request.method, headers, body: ['GET','HEAD'].includes(request.method) ? undefined : body })
    const payload = Buffer.from(await forwarded.arrayBuffer())
    if (response.destroyed) return
    response.writeHead(forwarded.status, { 'Content-Type': forwarded.headers.get('content-type') ?? 'application/octet-stream' })
    response.end(payload)
  } catch {
    if (!response.destroyed && !response.writableEnded) {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    }
  }
})
await new Promise((resolve) => host.listen(19425, resolve))
const browserProcess = spawn(browserPath, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  // Pin the UI language: the popup/overlay assertions are written in Chinese, and the
  // extension derives its locale from chrome.i18n.getUILanguage(). Keeps CI deterministic.
  '--lang=zh-CN', '--accept-lang=zh-CN',
  '--remote-debugging-port=19426', '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${path.join(scratch, `browser-${Date.now()}`)}`,
  `--disable-extensions-except=${path.join(root, 'apps/extension/dist/chrome')}`,
  `--load-extension=${path.join(root, 'apps/extension/dist/chrome')}`,
  ...(process.env.BOOKDOCK_PROBE_NO_SANDBOX ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
  'about:blank',
], { windowsHide: true, stdio: 'ignore' })

try {
  await until(() => fetch(baseUrl + '/api/v1/health').then((response) => response.ok), 'disposable server startup')
  const version = await until(() => fetch('http://127.0.0.1:19426/json/version').then((response) => response.json()), 'browser startup')
  console.log(`Browser: ${version.Browser}`)
  const browser = await cdp(version.webSocketDebuggerUrl)
  const targets = () => fetch('http://127.0.0.1:19426/json/list').then((response) => response.json())
  // Chrome also ships component extensions that expose a background.js worker, so confirm the worker's
  // manifest owns our popup before adopting its id.
  const extensionId = await until(async () => {
    for (const target of (await targets()).filter((entry) => entry.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(entry.url))) {
      const worker = await cdp(target.webSocketDebuggerUrl)
      const own = await worker.evaluate("chrome.runtime.getManifest().action?.default_popup === 'popup.html'").catch(() => false)
      if (own) return new URL(target.url).hostname
    }
    return undefined
  }, 'extension service worker')
  console.log(`Extension loaded: ${extensionId}`)
  const password = randomBytes(18).toString('base64url')
  const instance = await fetch(baseUrl + '/api/v1/auth/setup-required').then((response) => response.json())
  const credentials = { username: 'drop-probe', password }
  // The test server owns disposable data; every run starts with a fresh owner.
  assert.equal(instance.data.required, true, 'Use a fresh disposable server directory')
  const account = await api('/api/v1/auth/setup', credentials)
  const cookieSeparator = account.cookie.indexOf('=')
  await browser.send('Storage.setCookies', { cookies: [{ name: account.cookie.slice(0, cookieSeparator), value: account.cookie.slice(cookieSeparator + 1), url: baseUrl, httpOnly: true, sameSite: 'Strict' }] })
  const token = await api('/api/v1/tokens', { name: 'Drop probe', permissions: ['ext:upload'], expiresIn: '90d' }, account.cookie)
  assert.equal(typeof token.data.plaintext, 'string')
  async function openPage(url) {
    const { targetId } = await browser.send('Target.createTarget', { url })
    const target = await until(async () => (await targets()).find((entry) => entry.id === targetId), 'new page')
    const page = await cdp(target.webSocketDebuggerUrl)
    page.targetId = targetId
    await until(() => page.evaluate('document.readyState === "complete"'), 'page ready')
    return { page, targetId }
  }

  // The popup is the whole UI and the only settings surface, so the run configures it in place.
  const popup = await openPage(`chrome-extension://${extensionId}/popup.html`)
  await popup.page.send('Emulation.setDeviceMetricsOverride', { width: 384, height: 760, deviceScaleFactor: 1, mobile: false })
  await wait(600)
  async function shot(page, name) {
    const height = await page.evaluate('Math.ceil(document.body.getBoundingClientRect().height)')
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 384, height, scale: 1 } })
    await writeFile(path.join(scratch, name), Buffer.from(data, 'base64'))
  }
  await shot(popup.page, 'popup-connect.png')
  const options = popup.page
  // The popup is a launcher once connected: saving collapses the editor into the card, while an
  // unchanged form stays in the editor and only reports "连接正常". configure() leaves it collapsed.
  async function configure(url, secret = '') {
    if (await options.evaluate('document.getElementById("connection-panel").hidden')) await options.evaluate('document.getElementById("edit-connection").click()')
    const label = await options.evaluate(`(() => {
      const input = document.getElementById("instance-url");
      const token = document.getElementById("token");
      input.value = ${JSON.stringify(url)};
      token.value = ${JSON.stringify(secret)};
      input.dispatchEvent(new Event("input"));
      token.dispatchEvent(new Event("input"));
      return document.getElementById("save").textContent;
    })()`)
    // The label is the promise: "连接到书坞" / "测试并保存" write, everything else only tests.
    const saving = label !== '测试连接'
    await options.evaluate('document.getElementById("connection-form").requestSubmit()')
    await until(() => options.evaluate('!document.getElementById("save").disabled'), 'connection test and save')
    assert.doesNotMatch(await options.evaluate('document.getElementById("status").className'), /text-rose/, 'Connection test must not report an error')
    assert.equal(
      await options.evaluate('document.getElementById("connection-panel").hidden'),
      saving,
      saving ? 'Saving must collapse back into the launcher card' : 'A plain test must keep the editor open',
    )
    if (saving) assert.equal(await options.evaluate('document.getElementById("connection-card").hidden'), false, 'A saved connection must show the launcher card')
    else await options.evaluate('document.getElementById("cancel-edit").click()')
  }
  await configure(baseUrl, token.data.plaintext)
  await wait(400)

  // Identical settings only promise a test; any edit turns the button back into test-and-save.
  await options.evaluate('document.getElementById("edit-connection").click()')
  assert.equal(await options.evaluate('document.getElementById("save").textContent'), '测试连接', 'Unchanged settings must offer a plain test')
  await options.evaluate(`(() => { const input = document.getElementById("instance-url"); input.value = "http://127.0.0.1:19999"; input.dispatchEvent(new Event("input")) })()`)
  assert.equal(await options.evaluate('document.getElementById("save").textContent'), '测试并保存', 'An edited address must ask to save')
  await options.evaluate(`(() => { const input = document.getElementById("instance-url"); input.value = ${JSON.stringify(baseUrl)}; input.dispatchEvent(new Event("input")) })()`)
  assert.equal(await options.evaluate('document.getElementById("save").textContent'), '测试连接', 'Reverting the address must drop the save promise')

  // Nothing changed: the button only tests, and the status line only claims connectivity.
  await options.evaluate('document.getElementById("connection-form").requestSubmit()')
  await until(() => options.evaluate('!document.getElementById("save").disabled'), 'plain connection test')
  assert.equal(await options.evaluate('document.getElementById("status").textContent'), '连接正常', 'An unchanged test must only report connectivity')
  assert.equal(await options.evaluate('document.getElementById("connection-panel").hidden'), false, 'A plain test must leave the editor open')

  // The stored token is prefilled but masked; revealing it is a click, not a re-entry.
  assert.equal(await options.evaluate('document.getElementById("token").value'), token.data.plaintext, 'Saved token must be prefilled in the form')
  assert.equal(await options.evaluate('document.getElementById("token").type'), 'password', 'Saved token must stay masked by default')
  await options.evaluate('document.getElementById("show-token").click()')
  assert.equal(await options.evaluate('document.getElementById("token").type'), 'text', 'Show must reveal the saved token')
  await shot(popup.page, 'popup-edit.png')
  await options.evaluate('document.getElementById("show-token").click()')
  // Leaving the editor without saving restores the launcher card that the screenshot captures.
  await options.evaluate('document.getElementById("cancel-edit").click()')
  await until(() => options.evaluate('document.getElementById("connection-panel").hidden'), 'return to launcher card')
  await wait(300)
  await shot(popup.page, 'popup.png')

  // A request that never settles must release the button instead of spinning forever.
  await options.evaluate('document.getElementById("edit-connection").click()')
  await options.evaluate('window.__fetch = window.fetch; window.fetch = () => new Promise(() => {})')
  const timeoutStart = Date.now()
  await options.evaluate('document.getElementById("connection-form").requestSubmit()')
  await until(() => options.evaluate('!document.getElementById("save").disabled'), 'connect timeout guard', 30_000)
  const waited = Date.now() - timeoutStart
  assert.ok(waited > 15_000, `Timeout guard must not release early (waited ${waited}ms)`)
  assert.match(await options.evaluate('document.getElementById("status").textContent'), /超时/, 'A timeout must explain itself')
  await options.evaluate('window.fetch = window.__fetch; document.getElementById("cancel-edit").click()')

  await verifyUploads({ browser, cdp, targets, options, configure, openPage, until, wait, scratch, baseUrl, extensionId, token: token.data.plaintext, requests, failNames, controls, JSZip })

} finally {
  const browserConnection = connections[0]
  if (browserConnection) await browserConnection.send('Browser.close').catch(() => {})
  for (const connection of connections) connection.socket.close()
  browserProcess.kill()
  serverProcess.kill()
  await new Promise((resolve) => host.close(resolve))
}
