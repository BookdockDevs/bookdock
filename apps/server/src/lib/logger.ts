export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogRecord {
  ts: string
  level: LogLevel
  event: string
  message?: string
  requestId?: string
  method?: string
  path?: string
  status?: number
  durationMs?: number
  actorRole?: 'public' | 'owner' | 'member' | 'guest'
  error?: {
    name: string
    message: string
    stack?: string
  }
  meta?: Record<string, string | number | boolean | null>
}

export interface LogFields {
  message?: string
  requestId?: string
  method?: string
  path?: string
  status?: number
  durationMs?: number
  actorRole?: LogRecord['actorRole']
  error?: unknown
  meta?: Record<string, unknown>
}

const LEVEL_VALUE: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const SENSITIVE_VALUE = /((?:authorization|cookie|token|password|secret|api[-_ ]?key)[\w-]*\s*[:=]\s*)[^\s,;]+|Bearer\s+[^\s]+/gi
const SENSITIVE_KEY = /(?:authorization|cookie|token|password|secret|api[-_ ]?key)/i

let minimumLevel: LogLevel = 'info'

export function setLogLevel(level: LogLevel) {
  minimumLevel = level
}

export function getLogLevel() {
  return minimumLevel
}

function safeText(value: unknown): string {
  return String(value).replace(SENSITIVE_VALUE, '$1[REDACTED]')
}

function serializeError(value: unknown): LogRecord['error'] | undefined {
  if (!value) return undefined
  if (value instanceof Error) {
    const error: NonNullable<LogRecord['error']> = {
      name: safeText(value.name || 'Error'),
      message: safeText(value.message),
    }
    if (value.stack) error.stack = safeText(value.stack)
    return error
  }
  if (typeof value === 'object') {
    const source = value as { name?: unknown; message?: unknown; stack?: unknown }
    const error: NonNullable<LogRecord['error']> = {
      name: safeText(source.name || 'Error'),
      message: safeText(source.message || 'Unknown error'),
    }
    if (typeof source.stack === 'string') error.stack = safeText(source.stack)
    return error
  }
  return { name: 'Error', message: safeText(value) }
}

function serializeMeta(meta: Record<string, unknown> | undefined) {
  if (!meta) return undefined
  const output: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = '[REDACTED]'
      continue
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      output[key] = typeof value === 'string' ? safeText(value) : value
    } else if (typeof value === 'number') {
      output[key] = Number.isFinite(value) ? value : null
    } else if (typeof value === 'bigint') {
      output[key] = String(value)
    }
  }
  return Object.keys(output).length > 0 ? output : undefined
}

function toRecord(level: LogLevel, event: string, fields: LogFields): LogRecord {
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    event: safeText(event),
  }
  if (fields.message !== undefined) record.message = safeText(fields.message)
  if (fields.requestId !== undefined) record.requestId = safeText(fields.requestId)
  if (fields.method !== undefined) record.method = safeText(fields.method)
  if (fields.path !== undefined) record.path = safeText(fields.path)
  if (fields.status !== undefined) record.status = fields.status
  if (fields.durationMs !== undefined) record.durationMs = Math.max(0, Math.round(fields.durationMs))
  if (fields.actorRole !== undefined) record.actorRole = fields.actorRole
  const error = serializeError(fields.error)
  if (error) record.error = error
  const meta = serializeMeta(fields.meta)
  if (meta) record.meta = meta
  return record
}

export function log(level: LogLevel, event: string, fields: LogFields = {}) {
  if (LEVEL_VALUE[level] < LEVEL_VALUE[minimumLevel]) return
  const record = toRecord(level, event, fields)
  let line: string
  try {
    line = JSON.stringify(record)
  } catch {
    line = JSON.stringify({ ts: record.ts, level, event: record.event, message: 'Log serialization failed' })
  }
  if (level === 'error') console.error(line)
  else console.log(line)
}
