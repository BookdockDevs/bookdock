export interface ReadingTimerLease {
  deviceId: string
  mode: 'auto' | 'manual'
  activityAt: number
  expiresAt: number
}

export interface ReadingTimerClaimInput {
  deviceId: string
  mode: 'auto' | 'manual'
  activityAt: number
  explicit?: boolean
}

export function acceptsReadingTimerClaim(prior: ReadingTimerLease | undefined, input: ReadingTimerClaimInput, now: number): boolean {
  const activityAt = Math.min(input.activityAt, now)
  return !prior || prior.expiresAt <= now || (activityAt >= prior.activityAt && (
    (prior.deviceId === input.deviceId && !(prior.mode === 'manual' && input.mode === 'auto'))
    || (input.mode === 'manual' && input.explicit === true)
    || (prior.mode === 'auto' && input.mode === 'auto' && activityAt > prior.activityAt)
  ))
}
