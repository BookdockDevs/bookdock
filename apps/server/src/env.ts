import { z } from 'zod'
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
  AUTH_MODE: z.enum(['off', 'password']).default('password'),
  JWT_SECRET: z.string().optional(),
  DEFAULT_USERNAME: z.string().default('admin'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(104857600),
  STORAGE_DRIVER: z.enum(['localfs']).default('localfs'),
})

export type Env = z.infer<typeof envSchema>

let _env: Env | null = null

export function loadEnv(): Env {
  if (_env) return _env
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten())
    process.exit(1)
  }
  if (result.data.AUTH_MODE === 'password' && !result.data.JWT_SECRET) {
    console.error('JWT_SECRET is required when AUTH_MODE=password')
    process.exit(1)
  }
  _env = result.data
  return _env
}
