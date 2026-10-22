import type { ActivityEventInput } from '@bookdock/shared'

import { activityEvents } from '../db/schema'
import { getDb } from '../db/client'
import { createId } from './id'

type ActivityInsertDb = Pick<ReturnType<typeof getDb>, 'insert'>

const managementEvents = new Set([
  'work.trashed', 'work.restored', 'work.deleted', 'version.deleted', 'idea.deleted', 'review.deleted', 'comment.deleted', 'reply.deleted',
])

export function recordActivityEvent(tx: ActivityInsertDb, input: ActivityEventInput): void {
  if ((input.audience === 'manager') !== managementEvents.has(input.eventType)) {
    throw new Error('Activity audience does not match its event type')
  }
  const isManagement = input.audience === 'manager'
  tx.insert(activityEvents).values({
    id: createId(),
    idempotencyKey: input.idempotencyKey,
    eventType: input.eventType,
    audience: input.audience,
    libraryId: input.libraryId,
    actorUserId: input.actorUserId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    workId: input.workId ?? null,
    versionId: input.versionId ?? null,
    operationId: input.operationId ?? null,
    occurredAt: input.occurredAt,
    snapshotWorkTitle: isManagement ? input.snapshotWorkTitle?.slice(0, 500) ?? null : null,
    snapshotObjectLabel: isManagement ? input.snapshotObjectLabel?.slice(0, 200) ?? null : null,
    snapshotAuthorId: isManagement ? input.snapshotAuthorId ?? null : null,
  }).onConflictDoNothing({ target: activityEvents.idempotencyKey }).run()
}
