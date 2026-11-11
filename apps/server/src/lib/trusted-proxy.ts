import net from 'node:net'

export function normalizeIp(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.toLowerCase().startsWith('::ffff:')) {
    const mapped = trimmed.slice(7)
    if (net.isIP(mapped) === 4) return mapped
  }
  const family = net.isIP(trimmed)
  if (family === 4) return trimmed
  if (family === 6) return trimmed.toLowerCase()
  return null
}

/**
 * Parse a comma-separated IP/CIDR list into a Node `BlockList`.
 * Empty or `'none'` disables proxy header trust altogether.
 */
export function parseTrustedProxies(spec: string): net.BlockList | null {
  const trimmed = spec.trim()
  if (!trimmed || trimmed.toLowerCase() === 'none') return null

  const blockList = new net.BlockList()
  for (const rawEntry of trimmed.split(',')) {
    const entry = rawEntry.trim()
    if (!entry) continue
    const slashIndex = entry.indexOf('/')
    if (slashIndex >= 0) {
      const addrPart = entry.slice(0, slashIndex)
      const prefixPart = entry.slice(slashIndex + 1)
      if (!/^\d+$/.test(prefixPart)) {
        throw new Error(`Invalid TRUSTED_PROXIES CIDR prefix: ${entry}`)
      }
      const addr = normalizeIp(addrPart)
      const family = addr ? net.isIP(addr) : 0
      const prefix = Number(prefixPart)
      if (!addr || (family !== 4 && family !== 6)) {
        throw new Error(`Invalid TRUSTED_PROXIES CIDR address: ${entry}`)
      }
      const maxPrefix = family === 4 ? 32 : 128
      if (prefix < 0 || prefix > maxPrefix) {
        throw new Error(`Invalid TRUSTED_PROXIES CIDR prefix range: ${entry}`)
      }
      blockList.addSubnet(addr, prefix, family === 4 ? 'ipv4' : 'ipv6')
    } else {
      const addr = normalizeIp(entry)
      const family = addr ? net.isIP(addr) : 0
      if (!addr || (family !== 4 && family !== 6)) {
        throw new Error(`Invalid TRUSTED_PROXIES IP address: ${entry}`)
      }
      blockList.addAddress(addr, family === 4 ? 'ipv4' : 'ipv6')
    }
  }
  return blockList
}

function isTrusted(ip: string, blockList: net.BlockList | null): boolean {
  if (!blockList) return false
  const family = net.isIP(ip)
  if (family === 4) return blockList.check(ip, 'ipv4')
  if (family === 6) return blockList.check(ip, 'ipv6')
  return false
}

/**
 * Resolve the client IP for rate limiting without blindly trusting forwarding headers.
 * When the direct socket peer is in `trustedProxies`, `X-Forwarded-For` is walked
 * right-to-left to strip trusted hops and reject spoofed leftmost entries.
 */
export function resolveClientIp(
  socketAddress: string | undefined,
  xForwardedFor: string | undefined,
  xRealIp: string | undefined,
  blockList: net.BlockList | null,
): string {
  if (!socketAddress) return 'unknown'
  const peer = normalizeIp(socketAddress)
  if (!peer) return socketAddress
  if (!isTrusted(peer, blockList)) return peer

  if (xForwardedFor !== undefined && xForwardedFor.trim().length > 0) {
    const rawHops = xForwardedFor.split(',')
    const hops: string[] = []
    for (const rawHop of rawHops) {
      const normalized = normalizeIp(rawHop)
      if (!normalized) return peer
      hops.push(normalized)
    }
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      if (!isTrusted(hops[i]!, blockList)) {
        return hops[i]!
      }
    }
    return hops[0] ?? peer
  }

  if (xRealIp !== undefined) {
    const normalizedReal = normalizeIp(xRealIp)
    if (normalizedReal) return normalizedReal
  }

  return peer
}
