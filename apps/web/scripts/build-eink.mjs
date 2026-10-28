import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, '..')

const srcHtml = path.join(webRoot, 'src/eink/eink.html')
const srcEntry = path.join(webRoot, 'src/eink/index.ts')

const publicDir = path.join(webRoot, 'public')
const publicEinkDir = path.join(publicDir, 'eink')
const publicHtml = path.join(publicDir, 'eink.html')
const publicIndexHtml = path.join(publicEinkDir, 'index.html')
const publicJs = path.join(publicEinkDir, 'eink.js')

fs.mkdirSync(publicEinkDir, { recursive: true })

console.log('[build-eink] Bundling e-ink client with esbuild (target: es2019)...')
const externals = [
  '@pdfjs/*',
  './comic-book.js',
  './fb2.js',
  './mobi.js',
  './pdf.js',
  './vendor/zip.js',
  './vendor/fflate.js',
  './fixed-layout.js',
  './search.js',
  './tts.js',
].map(e => `--external:${e}`).join(' ')

const cmd = `pnpm exec esbuild "${srcEntry}" --bundle --minify --target=es2019 --format=iife --platform=browser ${externals} --outfile="${publicJs}"`
execSync(cmd, { stdio: 'inherit', cwd: webRoot })

// Copy HTML to public/
const bundleVersion = createHash('sha256').update(fs.readFileSync(publicJs)).digest('hex').slice(0, 12)
const htmlContent = fs.readFileSync(srcHtml, 'utf8').replace('/eink/eink.js', `/eink/eink.js?v=${bundleVersion}`)
fs.writeFileSync(publicHtml, htmlContent, 'utf8')
fs.writeFileSync(publicIndexHtml, htmlContent, 'utf8')

// If dist exists, keep dist in sync as well
const distDir = path.join(webRoot, 'dist')
if (fs.existsSync(distDir)) {
  const distEinkDir = path.join(distDir, 'eink')
  fs.mkdirSync(distEinkDir, { recursive: true })
  fs.copyFileSync(publicHtml, path.join(distDir, 'eink.html'))
  fs.copyFileSync(publicIndexHtml, path.join(distEinkDir, 'index.html'))
  fs.copyFileSync(publicJs, path.join(distEinkDir, 'eink.js'))
}

console.log('[build-eink] E-ink client built successfully!')
