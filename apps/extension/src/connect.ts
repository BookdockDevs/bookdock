import { testConnection } from './connection'
import { normalizeInstanceUrl } from './model'
import type { Connection } from './model'
import { getConnection, saveConnection } from './store'

interface ConnectOptions {
  enabled?: boolean
  autoOpen?: boolean
}

/** Tests an instance and stores the connection, reusing the previous id when nothing identity-related changed. */
export async function connect(baseValue: string, tokenValue: string, options: ConnectOptions = {}): Promise<Connection> {
  const previous = await getConnection()
  const baseUrl = normalizeInstanceUrl(baseValue)
  const token = tokenValue.trim() || (previous?.baseUrl === baseUrl ? previous.token : '')
  const tested = await testConnection(baseUrl, token)
  const unchanged = !!previous && previous.baseUrl === tested.baseUrl && previous.token === tested.token && previous.userId === tested.userId
  const connection: Connection = {
    ...tested,
    id: unchanged ? previous.id : crypto.randomUUID(),
    enabled: options.enabled ?? previous?.enabled ?? true,
    autoOpen: options.autoOpen ?? previous?.autoOpen ?? true,
  }
  await saveConnection(connection)
  return connection
}
