export const DEVICE_SETTINGS_KEY = 'bd-device-settings-v1'
export const DEVICE_READING_CONFIG_KEY = 'bd-local-reading-config-v1'

function initialAccountId(): string | null {
  try {
    const user = JSON.parse(localStorage.getItem('bd-user') ?? 'null')
    return user?.guest !== true && user?.role !== 'guest' && typeof user?.id === 'string' ? user.id : null
  } catch { return null }
}

let accountId = initialAccountId()
let hydrationDepth = 0

export function readingPreferenceAccountId(): string | null { return accountId }

export function bindReadingPreferenceAccount(nextAccountId: string | null) { accountId = nextAccountId }

export function canPersistDeviceReadingConfig(): boolean { return accountId === null && hydrationDepth === 0 }

export function withReadingPreferenceHydration(action: () => void) {
  hydrationDepth += 1
  try { action() } finally { hydrationDepth -= 1 }
}
