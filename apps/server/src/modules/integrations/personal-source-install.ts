import JSZip from 'jszip'
import { and, eq, sql } from 'drizzle-orm'

// JSZipObject's private internals, typed for bounded extraction. The
// declared uncompressed size comes from the central directory; internalStream
// exists at runtime but is missing from the public typings.
interface ZipEntryHandle {
  _data?: { uncompressedSize?: number }
  internalStream(type: string): {
    on(event: string, listener: (chunk: Buffer) => void): unknown
    pause(): unknown
    resume(): unknown
  }
}

import { personalMetadataSourceManifestSchema } from '@bookdock/shared'
import type { PersonalMetadataSourceManifest, PersonalMetadataSourceView } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { personalMetadataSources } from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import { config } from '../../config'
import { getStorage } from '../../storage'
import { personalSourceHasDetail } from './personal-source-runtime'

const GITHUB_USER_AGENT = 'Bookdock/0.7 (https://github.com/BookdockDevs/bookdock)'
const API_TIMEOUT_MS = 12_000
const ARCHIVE_TIMEOUT_MS = 30_000
const ARCHIVE_MAX_BYTES = 20_000_000
const MANIFEST_MAX_BYTES = 64_000
const ENTRY_MAX_BYTES = 2_000_000
const ICON_MAX_BYTES = 512_000
export const PERSONAL_SOURCE_LIMIT = 20

export interface ExtractedPackage {
  manifest: PersonalMetadataSourceManifest
  entry: Buffer
  icon: { data: Buffer; contentType: string } | null
}

export interface InstallOrigin {
  originType: 'github' | 'zip'
  originRef: string | null
  gitRef: string | null
  gitCommit: string | null
}

export function sourceStoragePrefix(userId: string, sourceId: string): string {
  return `sources/${userId}/${sourceId}`
}

function invalidPackage(message: string): AppError {
  return new AppError('PERSONAL_SOURCE_INVALID_PACKAGE', message)
}

export function parseGitHubUrl(input: string): { owner: string; repo: string; ref?: string } {
  let value = input.trim()
  if (!/^https?:\/\//i.test(value)) {
    // Accept the owner/repo shorthand for a bare repository URL.
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) value = `https://github.com/${value}`
    else throw new AppError('VALIDATION_ERROR', 'Expected a GitHub repository URL')
  }
  let url: URL
  try { url = new URL(value) } catch { throw new AppError('VALIDATION_ERROR', 'Expected a GitHub repository URL') }
  if (url.protocol !== 'https:' || (url.hostname !== 'github.com' && url.hostname !== 'www.github.com')) {
    throw new AppError('VALIDATION_ERROR', 'Expected a github.com repository URL')
  }
  const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
  if (parts.length < 2) throw new AppError('VALIDATION_ERROR', 'Expected a github.com repository URL')
  const [owner, rawRepo, kind, ...refParts] = parts
  const repo = rawRepo!.replace(/\.git$/i, '')
  if (!/^[A-Za-z0-9_.-]+$/.test(owner!) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid GitHub owner or repository name')
  }
  if (kind === undefined) return { owner: owner!, repo }
  // A URL may pin a reference via /tree/<ref>; branch names may contain slashes.
  if (kind !== 'tree' || refParts.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Only repository URLs or /tree/<ref> URLs are supported')
  }
  return { owner: owner!, repo, ref: refParts.join('/') }
}

function assertValidGitRef(ref: string): string {
  const segments = ref.split('/')
  const valid = ref.length <= 200
    && segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment) && !segment.startsWith('.') && segment !== '..')
    && segments.length > 0
  if (!valid) throw new AppError('VALIDATION_ERROR', 'Unsupported Git reference')
  return ref
}

function encodeRef(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/')
}

async function githubApi(path: string): Promise<Record<string, unknown> | null> {
  let response: Response
  try {
    response = await fetch(`https://api.github.com${path}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: { 'User-Agent': GITHUB_USER_AGENT, Accept: 'application/vnd.github+json' },
    })
  } catch {
    throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub API is unreachable')
  }
  if (response.status === 404) return null
  if (!response.ok) throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', `GitHub API returned HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > 1_000_000) throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub API response is too large')
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object')
    return value as Record<string, unknown>
  } catch {
    throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub API response could not be read')
  }
}

function field(value: unknown, max = 200): string | null {
  return typeof value === 'string' && value ? value.slice(0, max) : null
}

// Branches, tags and 40-character commit SHAs all resolve through the commits
// endpoint, which dereferences tags and accepts branch names with slashes.
async function resolveGitHubRef(target: { owner: string; repo: string; ref?: string }): Promise<{ ref: string | null; commit: string }> {
  if (!target.ref) {
    const repoInfo = await githubApi(`/repos/${target.owner}/${target.repo}`)
    if (!repoInfo) throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub repository not found')
    const defaultBranch = field(repoInfo.default_branch)
    if (!defaultBranch) throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub default branch could not be read')
    const commitInfo = await githubApi(`/repos/${target.owner}/${target.repo}/commits/${encodeRef(defaultBranch)}`)
    const commit = commitInfo ? field(commitInfo.sha, 40) : null
    if (!commit) throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub commit could not be resolved')
    return { ref: defaultBranch, commit }
  }
  const ref = assertValidGitRef(target.ref)
  if (/^[0-9a-f]{40}$/i.test(ref)) {
    const commitInfo = await githubApi(`/repos/${target.owner}/${target.repo}/commits/${ref}`)
    if (!commitInfo) throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub commit not found')
    return { ref, commit: ref }
  }
  const branch = await githubApi(`/repos/${target.owner}/${target.repo}/branches/${encodeRef(ref)}`)
  if (branch) {
    const commit = field((branch.commit as Record<string, unknown> | undefined)?.sha, 40)
    if (!commit) throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub commit could not be resolved')
    return { ref, commit }
  }
  const commitInfo = await githubApi(`/repos/${target.owner}/${target.repo}/commits/${encodeRef(ref)}`)
  const commit = commitInfo ? field(commitInfo.sha, 40) : null
  if (!commit) throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub branch, tag or commit not found')
  return { ref, commit }
}

async function downloadArchive(url: string): Promise<Buffer> {
  let response: Response
  try {
    response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
      headers: { 'User-Agent': GITHUB_USER_AGENT },
    })
  } catch {
    throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub archive download failed')
  }
  if (!response.ok) throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', `GitHub archive download returned HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (!reader) throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub archive download failed')
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > ARCHIVE_MAX_BYTES) throw new AppError('PERSONAL_SOURCE_UNAVAILABLE', 'GitHub archive is too large')
      parts.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(parts)
}

function sniffImageType(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

// GitHub zipballs (and some hand-made packages) wrap everything in one root
// directory; manifest.json at the archive root takes precedence, otherwise a
// single common top-level directory is stripped.
export async function extractPackage(archive: Buffer): Promise<ExtractedPackage> {
  let zip: JSZip
  try { zip = await JSZip.loadAsync(archive) } catch { throw invalidPackage('Archive could not be read') }
  const names = Object.keys(zip.files).filter((name) => !zip.files[name]!.dir && !name.includes('__MACOSX') && !name.endsWith('.DS_Store'))
  let prefix = ''
  if (!names.includes('manifest.json')) {
    const tops = new Set(names.map((name) => name.split('/')[0]))
    if (tops.size === 1) {
      const candidate = `${[...tops][0]!}/`
      if (names.includes(`${candidate}manifest.json`)) prefix = candidate
    }
    if (!prefix) throw invalidPackage('manifest.json was not found at the package root')
  }
  const readEntry = async (path: string, maxBytes: number): Promise<Buffer | null> => {
    const file = zip.file(prefix + path) as unknown as ZipEntryHandle | null
    if (!file) return null
    // Honest central-directory size is checked before inflating anything.
    const declared = file._data?.uncompressedSize
    if (typeof declared === 'number' && declared > maxBytes) throw invalidPackage(`Package file ${path} is too large`)
    // Inflate incrementally and stop at the cap, so a lying header cannot
    // balloon memory.
    const data = await new Promise<Buffer>((resolve, reject) => {
      const parts: Buffer[] = []
      let size = 0
      const stream = file.internalStream('nodebuffer')
      stream.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          stream.pause()
          reject(invalidPackage(`Package file ${path} is too large`))
          return
        }
        parts.push(chunk)
      })
      stream.on('error', reject)
      stream.on('end', () => resolve(Buffer.concat(parts)))
      // internalStream starts paused; events only flow after resume().
      stream.resume()
    })
    if (data.length > maxBytes) throw invalidPackage(`Package file ${path} is too large`)
    return data
  }
  const manifestRaw = await readEntry('manifest.json', MANIFEST_MAX_BYTES)
  if (!manifestRaw) throw invalidPackage('manifest.json was not found at the package root')
  let manifestJson: unknown
  try { manifestJson = JSON.parse(manifestRaw.toString('utf8')) } catch { throw invalidPackage('manifest.json is not valid JSON') }
  const manifest = personalMetadataSourceManifestSchema.safeParse(manifestJson)
  if (!manifest.success) throw invalidPackage('manifest.json does not match the package contract')
  const entry = await readEntry(manifest.data.entry, ENTRY_MAX_BYTES)
  if (!entry) throw invalidPackage('Package entry file was not found')
  if (!entry.toString('utf8').trim()) throw invalidPackage('Package entry file is empty')
  let icon: ExtractedPackage['icon'] = null
  if (manifest.data.icon) {
    const iconData = await readEntry(manifest.data.icon, ICON_MAX_BYTES)
    const contentType = iconData ? sniffImageType(iconData) : null
    if (!iconData || !contentType) throw invalidPackage('Package icon is missing or not a supported image')
    icon = { data: iconData, contentType }
  }
  return { manifest: manifest.data, entry, icon }
}

export async function extractPackageFromFile(file: File): Promise<ExtractedPackage> {
  if (file.size > config.personalSourceMaxBytes) {
    throw new AppError('UPLOAD_TOO_LARGE', 'Source package is too large')
  }
  return extractPackage(Buffer.from(await file.arrayBuffer()))
}

export function toPersonalSourceView(row: typeof personalMetadataSources.$inferSelect): PersonalMetadataSourceView {
  return {
    sourceId: row.sourceId,
    name: row.name,
    version: row.version,
    description: row.description ?? undefined,
    author: row.author ?? undefined,
    repository: row.repository ?? undefined,
    originType: row.originType,
    originRef: row.originRef ?? undefined,
    gitRef: row.gitRef ?? undefined,
    gitCommit: row.gitCommit ?? undefined,
    hasIcon: Boolean(row.iconType),
    hasDetail: row.hasDetail,
    createdAt: row.createdAt,
  }
}

async function persistSource(userId: string, pkg: ExtractedPackage, origin: InstallOrigin): Promise<PersonalMetadataSourceView> {
  const db = getDb()
  const existing = db
    .select({ id: personalMetadataSources.id })
    .from(personalMetadataSources)
    .where(and(eq(personalMetadataSources.userId, userId), eq(personalMetadataSources.sourceId, pkg.manifest.id)))
    .get()
  if (existing) {
    throw new AppError('PERSONAL_SOURCE_ALREADY_INSTALLED', 'A source with this ID is already installed; remove it first')
  }
  const count = db
    .select({ count: sql<number>`count(*)` })
    .from(personalMetadataSources)
    .where(eq(personalMetadataSources.userId, userId))
    .get()
  if ((count?.count ?? 0) >= PERSONAL_SOURCE_LIMIT) {
    throw new AppError('PERSONAL_SOURCE_LIMIT_REACHED', `At most ${PERSONAL_SOURCE_LIMIT} sources can be installed`)
  }
  const now = Date.now()
  const hasDetail = await personalSourceHasDetail(pkg.entry.toString('utf8'))
  const row: typeof personalMetadataSources.$inferInsert = {
    id: createId('pms'),
    userId,
    sourceId: pkg.manifest.id,
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    apiVersion: pkg.manifest.apiVersion,
    description: pkg.manifest.description ?? null,
    author: pkg.manifest.author ?? null,
    repository: pkg.manifest.repository ?? null,
    originType: origin.originType,
    originRef: origin.originRef,
    gitRef: origin.gitRef,
    gitCommit: origin.gitCommit,
    entryPath: pkg.manifest.entry,
    iconType: pkg.icon?.contentType ?? null,
    hasDetail,
    createdAt: now,
    updatedAt: now,
  }
  const storage = getStorage()
  const prefix = sourceStoragePrefix(userId, pkg.manifest.id)
  await storage.put(`${prefix}/entry.js`, pkg.entry)
  if (pkg.icon) await storage.put(`${prefix}/icon`, pkg.icon.data)
  try {
    db.insert(personalMetadataSources).values(row).run()
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      // Another row owns these storage paths; deleting them would break it.
      throw new AppError('PERSONAL_SOURCE_ALREADY_INSTALLED', 'A source with this ID is already installed; remove it first')
    }
    await storage.delete(`${prefix}/entry.js`).catch(() => {})
    if (pkg.icon) await storage.delete(`${prefix}/icon`).catch(() => {})
    throw error
  }
  return {
    sourceId: row.sourceId,
    name: row.name,
    version: row.version,
    description: row.description ?? undefined,
    author: row.author ?? undefined,
    repository: row.repository ?? undefined,
    originType: row.originType,
    originRef: row.originRef ?? undefined,
    gitRef: row.gitRef ?? undefined,
    gitCommit: row.gitCommit ?? undefined,
    hasIcon: Boolean(row.iconType),
    hasDetail,
    createdAt: row.createdAt,
  }
}

// Installs for one user are serialized: two concurrent packages could
// otherwise pass the existence check, write the same storage paths, and the
// loser's cleanup would delete the winner's files (or overwrite its entry).
const installLocks = new Map<string, Promise<unknown>>()

function withInstallLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = installLocks.get(userId) ?? Promise.resolve()
  const next = previous.then(task, task)
  installLocks.set(userId, next.catch(() => {}))
  return next
}

export function installPersonalSourceFromGitHub(userId: string, url: string): Promise<PersonalMetadataSourceView> {
  return withInstallLock(userId, async () => {
    const target = parseGitHubUrl(url)
    const resolved = await resolveGitHubRef(target)
    // Download by the resolved commit, not the mutable ref: a branch or tag
    // moving between resolution and download would otherwise install different
    // code than the recorded commit.
    const archive = await downloadArchive(`https://codeload.github.com/${target.owner}/${target.repo}/zip/${resolved.commit}`)
    const pkg = await extractPackage(archive)
    return persistSource(userId, pkg, {
      originType: 'github',
      originRef: `https://github.com/${target.owner}/${target.repo}`,
      gitRef: resolved.ref,
      gitCommit: resolved.commit,
    })
  })
}

export function installPersonalSourceFromZip(userId: string, file: File): Promise<PersonalMetadataSourceView> {
  return withInstallLock(userId, async () => {
    const pkg = await extractPackageFromFile(file)
    return persistSource(userId, pkg, {
      originType: 'zip',
      originRef: file.name.slice(0, 255) || null,
      gitRef: null,
      gitCommit: null,
    })
  })
}
