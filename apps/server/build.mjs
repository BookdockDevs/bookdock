// Production build: bundle the server (including @bookdock/shared, which ships
// as TypeScript source) into a single ESM file so plain `node dist/index.js`
// works without tsx or extension rewrites. Runtime deps from package.json stay
// external (better-sqlite3 is native) and are installed by `pnpm deploy`.
import { cpSync, rmSync } from 'node:fs'

import { build } from 'esbuild'

import pkg from './package.json' with { type: 'json' }

const external = Object.keys(pkg.dependencies).filter((dep) => dep !== '@bookdock/shared')

rmSync('dist', { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/index.js',
  external,
})

cpSync('src/db/migrations', 'dist/migrations', { recursive: true })
