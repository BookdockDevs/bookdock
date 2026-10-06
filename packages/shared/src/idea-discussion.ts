import { z } from 'zod'

import type { AnnotationRes } from './contract'

export interface IdeaAuthor {
  id: string
  name: string
  avatarKey: string | null
}

export interface ReaderIdea {
  annotation: AnnotationRes
  author: IdeaAuthor
  own: boolean
  canDelete: boolean
  likeCount: number
  commentCount: number
  liked: boolean
  locationAvailable: boolean
}

export interface IdeaComment {
  id: string
  parentId: string | null
  replyToId: string | null
  replyToName: string | null
  author: IdeaAuthor
  body: string | null
  createdAt: number
  editedAt: number | null
  deletedAt: number | null
  own: boolean
  canDelete: boolean
  liked: boolean
  likeCount: number
}

export interface IdeaDiscussion {
  idea: ReaderIdea
  comments: IdeaComment[]
  likers: IdeaAuthor[]
}

export interface IdeaComposerContext {
  eligible: boolean
  sourceReadable: boolean
  defaultVisibility: 'private' | 'shared'
  revisionId: string | null
}

export const ideaCommentCreateSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  replyToId: z.string().min(1).optional(),
}).strict()

export const ideaCommentUpdateSchema = z.object({
  body: z.string().trim().min(1).max(10000),
}).strict()

export const ideaLikeSchema = z.object({ liked: z.boolean() }).strict()
