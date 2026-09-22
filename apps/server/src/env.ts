import { z } from 'zod'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'

import { aiProviderSchema } from '@bookdock/shared'

import { log, setLogLevel } from './lib/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..', '..')

loadDotenv({ path: path.join(projectRoot, 'apps', 'server', '.env') })

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).default(3000),
  DATA_DIR: z.string().default(path.join(projectRoot, 'data')),
  DB_PATH: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(104857600),
  FONT_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(20971520),
  AVATAR_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(2097152),
  AUTH_RPM: z.coerce.number().int().min(1).max(120).default(5),
  // Set by the container launcher for one boot; absent in dev, which disables
  // the internal version route.
  BOOKDOCK_LAUNCHER_NONCE: z.string().min(8).optional(),
  STORAGE_DRIVER: z.enum(['localfs']).default('localfs'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  AI_PROVIDER: aiProviderSchema.default('openai'),
  AI_BASE_URL: z.string().trim().min(1).url().refine((value) => /^https?:\/\//i.test(value), 'Only HTTP(S) URLs are supported').optional(),
  AI_API_KEY: z.string().max(4096).optional(),
  AI_MODEL: z.string().trim().max(200).optional(),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(65536).default(8192),
  AI_RPM: z.coerce.number().int().min(1).max(120).default(6),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(300000),
})

export type Env = z.infer<typeof envSchema>

let _env: Env | null = null

// When JWT_SECRET is not provided via env, generate a random one and persist it
// under DATA_DIR so restarts keep issued tokens valid.
function loadOrCreateJwtSecret(dataDir: string): string {
  const secretPath = path.join(dataDir, '.jwt-secret')
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim()
    if (existing) return existing
  } catch {
    // not created yet
  }
  const secret = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(secretPath, secret, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.chmodSync(secretPath, 0o600)
  } catch {
    // best effort on non-POSIX filesystems
  }
  log('info', 'auth.jwt_secret.generated', { meta: { generated: true } })
  return secret
}

export function loadEnv(): Env {
  if (_env) return _env
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    setLogLevel('error')
    log('error', 'config.invalid', {
      message: 'Environment validation failed',
      meta: { issueCount: result.error.issues.length },
    })
    process.exit(1)
  }
  setLogLevel(result.data.LOG_LEVEL)
  if (!result.data.JWT_SECRET) {
    result.data.JWT_SECRET = loadOrCreateJwtSecret(result.data.DATA_DIR)
  }
  _env = result.data
  return _env
}
