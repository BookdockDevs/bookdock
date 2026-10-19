import { ApiError, apiPost } from '@/api/client'

let deviceId: string | undefined

export function readingDeviceId() {
  if (deviceId) return deviceId
  try {
    deviceId = sessionStorage.getItem('bd-reading-device') ?? crypto.randomUUID()
    sessionStorage.setItem('bd-reading-device', deviceId)
  } catch {
    deviceId = crypto.randomUUID()
  }
  return deviceId
}

export async function claimReadingTimer(mode: 'auto' | 'manual', explicit = false, activityAt = Date.now()) {
  try {
    const result = await apiPost<{ data: { granted: boolean } }>('/reading-records/claim', {
      deviceId: readingDeviceId(), mode, explicit, activityAt,
    })
    return result.data.granted
  } catch (error) {
    if (error instanceof ApiError && error.status && error.status < 500) return false
    // Offline candidates remain local until server overlap reconciliation.
    return true
  }
}

export function releaseReadingTimer() {
  void apiPost('/reading-records/release', { deviceId: readingDeviceId(), activityAt: Date.now() }).catch(() => {
    // A disconnected lease expires without blocking local save.
  })
}
