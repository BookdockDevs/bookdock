import type { ResourceAvailability } from '@bookdock/shared'

import { AppError } from '../middleware/error'

/**
 * Publishing is an instance-owner action. A member may still keep resources
 * private, and consuming a published resource never requires this right.
 */
export function assertCanPublish(role: string, availability: ResourceAvailability | undefined | null) {
  if (availability !== 'instance') return
  if (role === 'owner') return
  throw new AppError('FORBIDDEN', 'Only the instance owner can share resources with all users')
}
