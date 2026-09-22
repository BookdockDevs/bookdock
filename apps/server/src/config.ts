import { loadEnv } from './env'

const env = loadEnv()

export const config = Object.freeze({
  port: env.PORT,
  dataDir: env.DATA_DIR,
  dbPath: env.DB_PATH ?? `${env.DATA_DIR}/bookdock.db`,
  jwtSecret: env.JWT_SECRET ?? '',
  uploadMaxBytes: env.UPLOAD_MAX_BYTES,
  fontsMaxBytes: env.FONT_UPLOAD_MAX_BYTES,
  avatarMaxBytes: env.AVATAR_UPLOAD_MAX_BYTES,
  authRpm: env.AUTH_RPM,
  launcherNonce: env.BOOKDOCK_LAUNCHER_NONCE,
  storageDriver: env.STORAGE_DRIVER,
  logLevel: env.LOG_LEVEL,
  aiProvider: env.AI_PROVIDER,
  aiBaseUrl: env.AI_BASE_URL,
  aiApiKey: env.AI_API_KEY,
  aiModel: env.AI_MODEL,
  aiMaxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
  aiRpm: env.AI_RPM,
  aiTimeoutMs: env.AI_TIMEOUT_MS,
})
