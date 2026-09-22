import { BOOKDOCK_BUILD_INFO, compareReleaseVersions, parseReleaseVersion, type SystemUpdateCheckRes } from '@bookdock/shared'

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/BookdockDevs/bookdock/releases/latest'
const CACHE_TTL_MS = 15 * 60 * 1000
const FAILURE_CACHE_TTL_MS = 60 * 1000

interface UpdateCache {
  expiresAt: number
  result: SystemUpdateCheckRes
}

let updateCache: UpdateCache | null = null

/** Release tags are `v<version>`; anything else cannot be turned into an artifact URL. */
function parseTagName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const tag = value.trim()
  return /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(tag) ? tag : null
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
    const tag = parseTagName(release.tag_name)
    const latestVersion = parseReleaseVersion(tag?.replace(/^v/, ''))
    const currentVersion = parseReleaseVersion(BOOKDOCK_BUILD_INFO.version)
    if (!tag || !latestVersion || !currentVersion) return cacheResult(unavailableResult(), now)

    const releaseUrl = typeof release.html_url === 'string' && /^https:\/\//.test(release.html_url)
      ? release.html_url
      : BOOKDOCK_BUILD_INFO.releasesUrl
    const publishedAt = typeof release.published_at === 'string' && !Number.isNaN(Date.parse(release.published_at))
      ? release.published_at
      : undefined
    const result: SystemUpdateCheckRes = {
      status: compareReleaseVersions(latestVersion, currentVersion) > 0 ? 'update-available' : 'up-to-date',
      currentVersion: BOOKDOCK_BUILD_INFO.version,
      latestVersion: tag.replace(/^v/, ''),
      latestTag: tag,
      ...(publishedAt ? { publishedAt } : {}),
      releaseUrl,
    }
    return cacheResult(result, now)
  } catch {
    return cacheResult(unavailableResult(), now)
  }
}
