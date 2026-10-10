import crypto from 'node:crypto'

import { config } from '../config'

function encryptionKey() {
  return crypto.createHash('sha256').update(config.jwtSecret).digest()
}

export function encryptPassword(password: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function decryptPassword(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.')
    if (!ivEncoded || !tagEncoded || !ciphertextEncoded) return null
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivEncoded, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'))
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    return plain
  } catch {
    return null
  }
}
