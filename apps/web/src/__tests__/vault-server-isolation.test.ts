import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The device vault is where a book's own bytes and its reading data live when
 * they live on this machine. It is not an offline mode and it is not a second
 * system - which is exactly why it must never reach the server on its own.
 *
 * Uploading a device book is an explicit, user-initiated action that lives
 * outside this directory. Any API call appearing here would be a silent sync:
 * no screen asks for it, no test at runtime would catch it, and the book would
 * quietly stop being device-only.
 */
// The suite runs from apps/web, but resolving both keeps it correct if the
// workspace root ever drives the run.
const VAULT_DIR = [join(process.cwd(), 'src/features/local-library'), join(process.cwd(), 'apps/web/src/features/local-library')]
  .find((path) => existsSync(path))!
const BANNED_CALL = /\b(apiGet|apiPost|apiPut|apiPatch|apiDelete|apiUpload)\s*[<(]/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) return []
    return [path]
  })
}

describe('device vault isolation', () => {
  it('scans the vault sources', () => {
    // Guards against a path change turning the check below into a no-op.
    expect(sourceFiles(VAULT_DIR).length).toBeGreaterThan(20)
  })

  it('never calls the API client', () => {
    const offenders = sourceFiles(VAULT_DIR).flatMap((path) =>
      readFileSync(path, 'utf8').split('\n').flatMap((line, index) =>
        BANNED_CALL.test(line) ? [`${path.replace(VAULT_DIR + '\\', '').replace(VAULT_DIR + '/', '')}:${index + 1}: ${line.trim()}`] : [],
      ),
    )
    expect(offenders).toEqual([])
  })
})
