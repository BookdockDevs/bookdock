export function localRecordId(): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-'
  return Array.from(crypto.getRandomValues(new Uint8Array(21)), (value) => alphabet[value & 63]).join('')
}
export const LOCAL_VAULT_ID = 'device'

