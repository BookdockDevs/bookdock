import { z } from 'zod'

export const activityEventTypeSchema = z.enum([
  'idea.published',
  'review.published',
  'work.added',
  'version.added',
  'revision.published',
  'work.trashed',
  'work.restored',
  'work.deleted',
  'version.deleted',
  'idea.deleted',
  'review.deleted',
  'comment.deleted',
  'reply.deleted',
])
export type ActivityEventType = z.infer<typeof activityEventTypeSchema>

export const activityAudienceSchema = z.enum(['library', 'manager'])
export type ActivityAudience = z.infer<typeof activityAudienceSchema>

export const activityQuerySchema = z.object({
  scope: z.enum(['personal', 'library']),
  userId: z.string().min(1).optional(),
  libraryId: z.string().min(1).optional(),
  type: z.enum(['all', 'idea', 'review', 'catalog', 'management']).default('all'),
  cursor: z.string().min(1).max(2048).optional(),
  groupEventId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).superRefine((query, ctx) => {
  if (query.scope === 'library' && !query.libraryId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'libraryId is required for library scope', path: ['libraryId'] })
  }
  if (query.scope === 'personal' && query.libraryId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'libraryId is not allowed for personal scope', path: ['libraryId'] })
  }
  if (query.scope === 'library' && query.userId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'userId is not allowed for library scope', path: ['userId'] })
  }
  if (query.scope === 'personal' && query.groupEventId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'groupEventId is only allowed for library scope', path: ['groupEventId'] })
  }
})
export type ActivityQuery = z.infer<typeof activityQuerySchema>

export interface ActivityActor {
  id: string | null
  name: string
  avatarKey: string | null
}

interface ActivityItemBase {
  eventId: string
  occurredAt: number
  actor: ActivityActor
}

interface LibraryActivityItemBase extends ActivityItemBase {
  libraryId: string
  operationId: string | null
}

interface PersonalContentActivityItemBase extends ActivityItemBase {
  /** Private rows only appear in the author's personal feed. */
  visibility: 'private' | 'shared'
  libraryId: string | null
  operationId: string | null
}

export interface IdeaActivityItem extends PersonalContentActivityItemBase {
  kind: 'idea'
  eventType: 'idea.published' | 'idea.recorded'
  target: {
    ideaId: string
    libraryBookVersionId: string | null
    bookVersionId: string | null
    revisionId: string | null
  }
  content: { workTitle: string; libraryName: string | null; excerpt: string; chapter: string | null }
}

export interface ReviewActivityItem extends PersonalContentActivityItemBase {
  kind: 'review'
  eventType: 'review.published' | 'review.recorded'
  target: { reviewId: string; libraryBookId: string | null; bookVersionId: string | null }
  content: { workTitle: string; libraryName: string | null; title: string | null; excerpt: string; ratingHalves: number | null }
}

export interface CatalogActivityItem extends LibraryActivityItemBase {
  kind: 'catalog'
  eventType: 'work.added' | 'version.added' | 'revision.published'
  target: { workId: string; versionId: string | null }
  content: { workTitle: string; objectLabel: string | null; bookVersionId: string | null }
}

export interface CatalogActivityGroupItem extends LibraryActivityItemBase {
  kind: 'catalog-group'
  eventType: 'work.added' | 'version.added' | 'revision.published'
  operationId: string
  count: number
  preview: Array<{ workId: string; versionId: string | null; workTitle: string; objectLabel: string | null; bookVersionId: string | null }>
}

export interface ManagementActivityGroupItem extends LibraryActivityItemBase {
  kind: 'management-group'
  eventType: ManagementActivityItem['eventType']
  operationId: string
  count: number
  preview: Array<{ targetKind: string; targetId: string; workTitle: string | null; objectLabel: string | null }>
}

export interface ManagementActivityItem extends LibraryActivityItemBase {
  kind: 'management'
  eventType: 'work.trashed' | 'work.restored' | 'work.deleted' | 'version.deleted' | 'idea.deleted' | 'review.deleted' | 'comment.deleted' | 'reply.deleted'
  target: { kind: string; id: string; workId: string | null; versionId: string | null; authorId: string | null }
  content: { workTitle: string | null; objectLabel: string | null }
}

export type ActivityItem = IdeaActivityItem | ReviewActivityItem | CatalogActivityItem | CatalogActivityGroupItem | ManagementActivityItem | ManagementActivityGroupItem

export interface ActivityPage {
  items: ActivityItem[]
  nextCursor: string | null
  canManage: boolean
  groupEventId?: string
}

export interface ActivityEventInput {
  idempotencyKey: string
  eventType: ActivityEventType
  audience: ActivityAudience
  libraryId: string
  actorUserId: string | null
  targetKind: string
  targetId: string
  workId?: string | null
  /** Canonical BookVersion.id; source listing IDs remain on the original domain row/targetId. */
  versionId?: string | null
  operationId?: string | null
  occurredAt: number
  snapshotWorkTitle?: string | null
  snapshotObjectLabel?: string | null
  snapshotAuthorId?: string | null
}
