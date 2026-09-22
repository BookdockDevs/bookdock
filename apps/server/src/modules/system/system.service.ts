import { BOOKDOCK_BUILD_INFO, type SystemUpdateCheckRes } from '@bookdock/shared'

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/BookdockDevs/bookdock/releases/latest'
const CACHE_TTL_MS = 15 * 60 * 1000
const FAILURE_CACHE_TTL_MS = 60 * 1000

interface UpdateCache {
  expiresAt: number
  result: SystemUpdateCheckRes
}

let updateCache: UpdateCache | null = null

function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersions(left: [number, number, number], right: [number, number, number]) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

function unavailableResult(): SystemUpdateCheckRes {
  return {
    status: 'unavailable',
    currentVersion: BOOKDOCK_BUILD_INFO.version,
  }
}

function cacheResult(result: SystemUpdateCheckRes, now: number) {
  updateCache = {
    result,
    expiresAt: now + (result.status === 'unavailable' ? FAILURE_CACHE_TTL_MS : CACHE_TTL_MS),
  }
  return result
}

export function clearUpdateCheckCache() {
  updateCache = null
}

export async function checkForUpdates(): Promise<SystemUpdateCheckRes> {
  const now = Date.now()
  if (updateCache && updateCache.expiresAt > now) return updateCache.result

  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Bookdock/${BOOKDOCK_BUILD_INFO.version}`,
      },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return cacheResult(unavailableResult(), now)

    const release = await response.json() as Record<string, unknown>
    if (typeof release.tag_name !== 'string') return cacheResult(unavailableResult(), now)
    const latestVersion = parseVersion(release.tag_name)
    const currentVersion = parseVersion(BOOKDOCK_BUILD_INFO.version)
    if (!latestVersion || !currentVersion) return cacheResult(unavailableResult(), now)

    const releaseUrl = typeof release.html_url === 'string' && /^https:\/\//.test(release.html_url)
      ? release.html_url
      : BOOKDOCK_BUILD_INFO.releasesUrl
    const publishedAt = typeof release.published_at === 'string' && !Number.isNaN(Date.parse(release.published_at))
      ? release.published_at
      : undefined
    const result: SystemUpdateCheckRes = {
      status: compareVersions(latestVersion, currentVersion) > 0 ? 'update-available' : 'up-to-date',
      currentVersion: BOOKDOCK_BUILD_INFO.version,
      latestVersion: release.tag_name.toString().replace(/^v/, ''),
      ...(publishedAt ? { publishedAt } : {}),
      releaseUrl,
    }
    return cacheResult(result, now)
  } catch {
    return cacheResult(unavailableResult(), now)
  }
}
