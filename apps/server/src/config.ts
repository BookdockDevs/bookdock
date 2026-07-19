import { loadEnv } from './env'

const env = loadEnv()

export const config = Object.freeze({
  port: env.PORT,
  dataDir: env.DATA_DIR,
  dbPath: env.DB_PATH ?? `${env.DATA_DIR}/bookdock.db`,
  authMode: env.AUTH_MODE,
  jwtSecret: env.JWT_SECRET ?? '',
  defaultUsername: env.DEFAULT_USERNAME,
  uploadMaxBytes: env.UPLOAD_MAX_BYTES,
  storageDriver: env.STORAGE_DRIVER,
})
