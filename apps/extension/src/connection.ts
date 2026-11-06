import type { AuthenticatedMeRes, InstanceInfoRes, MeRes } from '@bookdock/shared'

import { t } from './i18n'
import { normalizeInstanceUrl } from './model'
import type { Connection } from './model'

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new Error(t('error.tokenInvalid'))
  if (response.status === 403) throw new Error(t('error.tokenForbidden'))
  if (!response.ok) throw new Error(t('error.instanceDown', { status: response.status }))
  const body = await response.json() as { data: T }
  if (!body || typeof body !== 'object' || !body.data) throw new Error(t('error.instanceBadResponse'))
  return body.data
}

/**
 * One probe per instance + token, shared by everything that asks for it in this page's lifetime.
 * Uploading calls this once per file, but identity, scope and the size ceiling only change when
 * the connection does — 20 files would otherwise cost 40 redundant requests. Failures are dropped
 * from the map so a later attempt still reaches the network.
 */
const probes = new Map<string, Promise<Omit<Connection, 'id' | 'enabled'>>>()

export function testConnectionOnce(baseValue: string, token: string): Promise<Omit<Connection, 'id' | 'enabled'>> {
  const key = `${normalizeInstanceUrl(baseValue)}|${token}`
  const running = probes.get(key)
  if (running) return running
  const probe = testConnection(baseValue, token)
  probes.set(key, probe)
  // Attaching the handler here also keeps `probe` itself from reporting an unhandled rejection.
  probe.catch(() => { probes.delete(key) })
  return probe
}

export async function testConnection(baseValue: string, token: string): Promise<Omit<Connection, 'id' | 'enabled'>> {
  const baseUrl = normalizeInstanceUrl(baseValue)
  if (!/^bd_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error(t('error.tokenFormat'))
  try {
    const [me, instance] = await Promise.all([
      fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000) }).then(readJson<MeRes>),
      fetch(`${baseUrl}/api/v1/auth/instance`, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000) }).then(readJson<InstanceInfoRes>),
    ])
    // Tokens are only ever issued to signed-in accounts (the token routes reject guests),
    // so a guest reply means the token itself is unusable rather than that the user is logged out.
    if (me.guest || !('id' in me) || typeof me.id !== 'string' || typeof me.username !== 'string') throw new Error(t('error.tokenInvalid'))
    const permissions = (me as AuthenticatedMeRes).tokenPermissions
    if (permissions && !permissions.includes('ext:upload')) throw new Error(t('error.tokenScope'))
    if (!Number.isSafeInteger(instance.uploadMaxBytes) || instance.uploadMaxBytes <= 0) throw new Error(t('error.instanceBadResponse'))
    if (me.role !== 'owner' && !instance.allowUserUpload) throw new Error(t('error.memberBlocked'))
    return { baseUrl, token, userId: me.id, username: me.username, uploadMaxBytes: instance.uploadMaxBytes }
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name))) throw new Error(t('error.unreachable'))
    throw error
  }
}
