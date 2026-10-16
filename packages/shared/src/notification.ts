import { z } from 'zod'

import type { IdeaAuthor } from './idea-discussion'
import { archiveQuerySchema, type ArchivePage } from './reader-profile'

export const interactionRequestIdSchema = z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/)
export type NotificationDomain = 'idea' | 'review'
export type NotificationEvent = 'comment' | 'reply' | 'like'

export interface InteractionNotification {
  id: string
  domain: NotificationDomain
  event: NotificationEvent
  targetId: string
  commentId: string | null
  actor: IdeaAuthor
  preview: string
  createdAt: number
  readAt: number | null
}

export type NotificationPage = ArchivePage<InteractionNotification>
export const notificationQuerySchema = archiveQuerySchema.extend({
  unread: z.preprocess(
    (value) => value === undefined ? 'false' : value,
    z.union([z.literal('true'), z.literal('false')]).transform((value) => value === 'true'),
  ),
})
export type NotificationQuery = z.infer<typeof notificationQuerySchema>
export type NotificationTarget =
  | { available: false }
  | { available: true; notification: InteractionNotification }

export const notificationReadSchema = z.object({ read: z.boolean() }).strict()
