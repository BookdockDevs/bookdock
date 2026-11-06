import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const folder = path.join(root, 'apps/extension')
const require = createRequire(path.join(folder, 'package.json'))
const JSZip = require('jszip')
const sharp = require('sharp')
const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'))

for (const browser of ['chrome', 'firefox']) {
  const archive = await readFile(path.join(folder, 'dist', `bookdock-extension-${browser}-${pkg.version}.zip`))
  const zip = await JSZip.loadAsync(archive)
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'))
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.manifest_version, 3)
  assert.deepEqual(manifest.permissions, ['alarms', 'scripting'])
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*'])
  assert.equal(manifest.content_security_policy.extension_pages.includes('unsafe-eval'), false)
  assert.equal(manifest.web_accessible_resources, undefined)
  assert.equal(manifest.options_ui, undefined)
  assert.ok(zip.file('LICENSE'))
  const files = ['background.js', 'content.js', 'popup.js', 'upload.js', 'styles.css', manifest.action.default_popup]
  for (const file of files) {
    assert.ok(zip.file(file), `Missing ${browser} asset: ${file}`)
    const bytes = await zip.file(file).async('nodebuffer')
    assert.ok(bytes.length > 0)
    assert.deepEqual(bytes, await readFile(path.join(folder, 'dist', browser, file)))
    if (file.endsWith('.js')) {
      const source = bytes.toString()
      assert.ok(!/\beval\s*\(|new Function\s*\(/.test(source), 'Remote/eval execution is prohibited')
    }
  }
  for (const [size, file] of Object.entries(manifest.icons)) {
    const metadata = await sharp(await zip.file(file).async('nodebuffer')).metadata()
    assert.equal(metadata.width, Number(size))
    assert.equal(metadata.height, Number(size))
  }
  for (const locale of ['zh_CN', 'en']) {
    const messages = JSON.parse(await zip.file(`_locales/${locale}/messages.json`).async('string'))
    assert.ok(messages.extensionName.message && messages.extensionDescription.message)
  }
  if (browser === 'chrome') assert.equal(manifest.background.service_worker, 'background.js')
  else {
    assert.equal(manifest.background.service_worker, undefined)
    assert.deepEqual(manifest.background.scripts, ['background.js'])
    assert.ok(manifest.browser_specific_settings.gecko.data_collection_permissions.required.includes('authenticationInfo'))
  }
  assert.ok(Object.keys(zip.files).every((file) => !file.includes('node_modules') && !file.includes('probe/') && !file.endsWith('.map')))
  console.log(`${browser}: validated ${Object.keys(zip.files).length} archive entries, sha256 ${createHash('sha256').update(archive).digest('hex')}`)
}
const source = await JSZip.loadAsync(await readFile(path.join(folder, 'dist', `bookdock-extension-source-${pkg.version}.zip`)))
for (const file of ['LICENSE', 'pnpm-lock.yaml', 'apps/extension/build.mjs', 'apps/extension/src/store.ts', 'apps/extension/pages/popup.html', 'apps/web/public/favicon.svg', 'packages/shared/package.json']) assert.ok(source.file(file), `Missing source build input: ${file}`)
assert.ok(Object.keys(source.files).every((file) => !file.includes('node_modules/') && !file.includes('/dist/') && !file.endsWith('.env')))
console.log('Source archive: build inputs present; no runtime data or credentials')
