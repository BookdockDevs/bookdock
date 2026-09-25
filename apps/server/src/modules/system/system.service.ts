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

function unavailableResult(failureReason?: string): SystemUpdateCheckRes {
  return {
    status: 'unavailable',
    currentVersion: BOOKDOCK_BUILD_INFO.version,
    ...(failureReason ? { failureReason } : {}),
  }
}

export function describeUpdateNetworkFailure(error: unknown, request: string) {
  const codes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'])
  const names = new Set(['TimeoutError', 'AbortError'])
  let current = error
  let code: string | undefined
  let timedOut = false
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; name?: unknown; cause?: unknown }
    if (typeof candidate.code === 'string' && codes.has(candidate.code)) code = candidate.code
    if (typeof candidate.name === 'string' && names.has(candidate.name)) timedOut = true
    if (!candidate.cause) break
    current = candidate.cause
  }

  let reason = 'request failed before an HTTP response'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') reason = `DNS lookup failed (${code})`
  else if (code === 'ECONNREFUSED') reason = 'connection was refused (ECONNREFUSED)'
  else if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') reason = `connection was reset (${code})`
  else if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || timedOut) reason = `request timed out${code ? ` (${code})` : ''}`
  else if (hasTlsFailureCode(error)) reason = 'TLS handshake or certificate validation failed'

  return `${request}: ${reason}. Check container DNS, outbound HTTPS, proxy, and certificate settings.`
}

function hasTlsFailureCode(error: unknown) {
  let current = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && (code.startsWith('ERR_TLS') || code.startsWith('CERT_'))) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
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

export async function checkForUpdates(signal?: AbortSignal): Promise<SystemUpdateCheckRes> {
  const now = Date.now()
  if (updateCache && updateCache.expiresAt > now) return updateCache.result

  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Bookdock/${BOOKDOCK_BUILD_INFO.version}`,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    })
    if (!response.ok) return cacheResult(unavailableResult(`GitHub release check returned HTTP ${response.status}.`), now)

    const release = await response.json() as Record<string, unknown>
    const tag = parseTagName(release.tag_name)
    const latestVersion = parseReleaseVersion(tag?.replace(/^v/, ''))
    const currentVersion = parseReleaseVersion(BOOKDOCK_BUILD_INFO.version)
    if (!tag || !latestVersion || !currentVersion) return cacheResult(unavailableResult('GitHub returned release metadata that Bookdock could not interpret.'), now)

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
  } catch (error) {
    return cacheResult(unavailableResult(describeUpdateNetworkFailure(error, 'GitHub release check')), now)
  }
}
