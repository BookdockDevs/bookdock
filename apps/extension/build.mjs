import { readFile, readdir, mkdir, rm, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { build } from 'esbuild'
import JSZip from 'jszip'
import sharp from 'sharp'

const root = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const compiler = await compile(await readFile(path.join(root, 'src/styles.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
const sharedUi = [
  'components/ui/Button.tsx', 'components/ui/Modal.tsx', 'components/ui/ToastStack.tsx',
  'components/ui/dialog-layout-context.ts', 'stores/toast.store.ts', 'lib/utils.ts', 'lib/error-keys.ts',
  'features/library/components/UploadFilesPanel.tsx', 'features/library/upload-types.ts',
  'features/library/upload-feedback.ts', 'i18n/locales/zh-CN.json', 'styles/ui-font.css', 'styles/overlays.css', 'styles/scrollbars.css',
]
const scanner = new Scanner({ sources: [
  { base: root, pattern: 'src/**/*.{ts,tsx}', negated: false },
  { base: root, pattern: 'pages/**/*.html', negated: false },
  ...sharedUi.filter((file) => file.endsWith('.tsx') || file.endsWith('.ts')).map((file) => ({ base: path.resolve(root, '../web/src'), pattern: file, negated: false })),
] })
const candidates = new Set(scanner.scan())
const sharedSources = await Promise.all(sharedUi.filter((file) => /\.(ts|tsx)$/.test(file)).map(async (file) => ({ content: await readFile(path.resolve(root, '../web/src', file), 'utf8'), extension: path.extname(file).slice(1) })))
for (const candidate of scanner.scanFiles(sharedSources)) candidates.add(candidate)
const css = compiler.build([...candidates])
const icon = await readFile(path.join(root, '../web/public/favicon.svg'))

for (const browser of ['chrome', 'firefox']) {
  const out = path.join(root, 'dist', browser)
  await rm(out, { recursive: true, force: true })
  await mkdir(path.join(out, 'icons'), { recursive: true })
  await build({
    absWorkingDir: root,
    entryPoints: ['background', 'content', 'popup'].map((name) => `src/${name}.ts`).concat('src/upload.tsx'),
    outdir: out, bundle: true, format: 'iife', target: browser === 'chrome' ? 'chrome120' : 'firefox140',
    nodePaths: [path.join(root, 'node_modules')],
    minify: true, legalComments: 'none', jsx: 'automatic',
    alias: { '@/hooks/useTranslation': path.join(root, 'src/useTranslation.ts'), '@': path.resolve(root, '../web/src') },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'styles', setup(plugin) {
      plugin.onResolve({ filter: /^virtual:styles$/ }, () => ({ path: 'styles', namespace: 'inline-css' }))
      plugin.onLoad({ filter: /.*/, namespace: 'inline-css' }, () => ({ contents: `export default ${JSON.stringify(css)}`, loader: 'js' }))
    } }],
  })
  for (const file of await readdir(path.join(root, 'pages'))) await copyFile(path.join(root, 'pages', file), path.join(out, file))
  await copyFile(path.join(root, '../../LICENSE'), path.join(out, 'LICENSE'))
  await mkdir(path.join(out, 'fonts'), { recursive: true })
  await copyFile(path.join(root, '../web/public/fonts/InterVariable.woff2'), path.join(out, 'fonts/InterVariable.woff2'))
  await writeFile(path.join(out, 'styles.css'), css)
  await writeFile(path.join(out, 'version.js'), `for(const node of document.querySelectorAll('[data-version]'))node.textContent=${JSON.stringify(pkg.version)};\n`)
  for (const size of [16, 32, 48, 128]) await sharp(icon).resize(size, size).png().toFile(path.join(out, 'icons', `${size}.png`))
  const icons = Object.fromEntries([16, 32, 48, 128].map((size) => [size, `icons/${size}.png`]))
  const manifest = {
    manifest_version: 3,
    name: '__MSG_extensionName__', description: '__MSG_extensionDescription__', default_locale: 'zh_CN',
    version: pkg.version, homepage_url: 'https://github.com/BookdockDevs/bookdock',
    icons, action: { default_title: '__MSG_extensionName__', default_popup: 'popup.html', default_icon: icons },
    permissions: ['alarms', 'scripting'],
    host_permissions: ['http://*/*', 'https://*/*'],
    background: browser === 'chrome' ? { service_worker: 'background.js' } : { scripts: ['background.js'] },
    content_scripts: [{ matches: ['http://*/*', 'https://*/*'], js: ['content.js'], all_frames: true, run_at: 'document_start' }],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'" },
    ...(browser === 'chrome' ? { minimum_chrome_version: '120' } : {
      browser_specific_settings: { gecko: { id: 'extension@bookdock.org', strict_min_version: '140.0', data_collection_permissions: { required: ['authenticationInfo', 'websiteContent'] } } },
    }),
  }
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  for (const [locale, name, description] of [
    ['zh_CN', '书坞', '快速将电子书（EPUB / TXT）推送到你的自建书坞实例，支持全网网页拖拽投送与即刻阅读。'],
    ['en', 'Bookdock', 'Easily send EPUB/TXT ebooks to your self-hosted Bookdock library with drag-and-drop web delivery and instant reading.'],
  ]) {
    await mkdir(path.join(out, '_locales', locale), { recursive: true })
    await writeFile(path.join(out, '_locales', locale, 'messages.json'), JSON.stringify({ extensionName: { message: name }, extensionDescription: { message: description } }, null, 2) + '\n')
  }
  if (process.argv.includes('--pack')) {
    const zip = new JSZip()
    async function collect(folder, prefix = '') {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const name = prefix + entry.name
        if (entry.isDirectory()) await collect(path.join(folder, entry.name), `${name}/`)
        else zip.file(name, await readFile(path.join(folder, entry.name)))
      }
    }
    await collect(out)
    await writeFile(path.join(root, 'dist', `bookdock-extension-${browser}-${pkg.version}.zip`), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  }
  console.log(`Built ${browser} extension ${pkg.version}`)
}

if (process.argv.includes('--pack')) {
  const sourceZip = new JSZip()
  const workspace = path.resolve(root, '../..')
  async function addSource(folder, prefix) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'probe'].includes(entry.name)) continue
      const name = `${prefix}/${entry.name}`
      if (entry.isDirectory()) await addSource(path.join(folder, entry.name), name)
      else sourceZip.file(name, await readFile(path.join(folder, entry.name)))
    }
  }
  await addSource(root, 'apps/extension')
  await addSource(path.join(workspace, 'packages/shared/src'), 'packages/shared/src')
  for (const file of sharedUi) sourceZip.file(`apps/web/src/${file}`, await readFile(path.join(workspace, 'apps/web/src', file)))
  sourceZip.file('apps/web/public/fonts/InterVariable.woff2', await readFile(path.join(workspace, 'apps/web/public/fonts/InterVariable.woff2')))
  for (const file of ['LICENSE', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'packages/shared/package.json', 'packages/shared/tsconfig.json', 'apps/web/public/favicon.svg']) {
    sourceZip.file(file, await readFile(path.join(workspace, file)))
  }
  await writeFile(path.join(root, 'dist', `bookdock-extension-source-${pkg.version}.zip`), await sourceZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}
