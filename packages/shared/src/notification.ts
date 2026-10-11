import { z } from 'zod'

import type { IdeaAuthor } from './idea-discussion'
import type { ArchivePage } from './reader-profile'

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
export type NotificationTarget =
  | { available: false }
  | { available: true; notification: InteractionNotification }

export const notificationReadSchema = z.object({ read: z.boolean() }).strict()
