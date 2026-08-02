import { z } from 'zod'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..', '..')

loadDotenv({ path: path.join(projectRoot, 'apps', 'server', '.env') })

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).default(3000),
  DATA_DIR: z.string().default(path.join(projectRoot, 'data')),
  DB_PATH: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  DEFAULT_USERNAME: z.string().default('admin'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(104857600),
  STORAGE_DRIVER: z.enum(['localfs']).default('localfs'),
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
  console.log(`[auth] JWT_SECRET not set; generated and persisted to ${secretPath}`)
  return secret
}

export function loadEnv(): Env {
  if (_env) return _env
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten())
    process.exit(1)
  }
  if (!result.data.JWT_SECRET) {
    result.data.JWT_SECRET = loadOrCreateJwtSecret(result.data.DATA_DIR)
  }
  _env = result.data
  return _env
}
