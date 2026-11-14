import crypto from 'node:crypto'

import { config } from '../../config'

// The key derivation and payload layout are unchanged from the AI profile era
// so migrated `encrypted_api_key` values keep decrypting without a re-encrypt.
function encryptionKey() {
  return crypto.createHash('sha256').update(config.jwtSecret).digest()
}

export function encryptApiKey(value: string | null) {
  if (!value?.trim()) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(value.trim(), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function decryptApiKey(value: string | undefined) {
  if (!value) return undefined
  try {
    const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.')
    if (!ivEncoded || !tagEncoded || !ciphertextEncoded) return undefined
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivEncoded, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8') || undefined
  } catch {
    return undefined
  }
}
