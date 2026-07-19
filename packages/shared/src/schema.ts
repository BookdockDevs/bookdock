import { z } from 'zod'
import { PAGINATION } from './constants'

export const bookFormatSchema = z.enum(['epub', 'txt'])

export const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(256),
})

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  pageSize: z.coerce.number().int().min(1).max(PAGINATION.MAX_PAGE_SIZE).default(PAGINATION.DEFAULT_PAGE_SIZE),
})

export const readingProgressUpdateSchema = z.object({
  cfi: z.string().optional(),
  chapter: z.string().optional(),
  percent: z.number().min(0).max(100),
})

export const settingsUpdateSchema = z.object({
  uiTheme: z.enum(['system', 'light', 'dark']).optional(),
  readingThemeId: z.enum(['paper', 'sepia', 'night', 'cream']).optional(),
  lightReadingThemeId: z.enum(['paper', 'sepia', 'night', 'cream']).optional(),
  fontFamily: z.enum(['serif', 'sans-serif', 'kaiti', 'fangsong']).optional(),
  fontSize: z.number().min(12).max(32).optional(),
  lineHeight: z.number().min(1.2).max(2.5).optional(),
  paragraphSpacing: z.number().min(0).max(3).optional(),
  letterSpacing: z.number().min(-1).max(3).optional(),
  indent: z.number().min(0).max(4).optional(),
  pageWidth: z.union([z.literal('auto'), z.number()]).optional(),
})

export const annotationCreateSchema = z.object({
  cfiRange: z.string().min(1),
  cfiAnchor: z.string().optional(),
  type: z.enum(['highlight', 'note', 'bookmark']),
  color: z.string().optional().default('yellow'),
  style: z.enum(['underline', 'squiggly', 'highlight']).optional().default('underline'),
  text: z.string().optional().default(''),
  note: z.string().optional(),
  chapter: z.string().optional(),
})

export const annotationUpdateSchema = z.object({
  color: z.string().optional(),
  style: z.enum(['underline', 'squiggly', 'highlight']).optional(),
  note: z.string().optional(),
  text: z.string().optional(),
})

export const setupSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(6).max(256),
})

export const setupRequiredSchema = z.object({
  required: z.boolean(),
})

export const shelfCreateSchema = z.object({ name: z.string().min(1).max(100) })
export const shelfUpdateSchema = z.object({ name: z.string().min(1).max(100) })
export const tagCreateSchema = z.object({ name: z.string().min(1).max(100) })
export const tagUpdateSchema = z.object({ name: z.string().min(1).max(100) })
export const bookMembershipSchema = z.object({
  shelfIds: z.array(z.string().min(1)).optional(),
  tagIds: z.array(z.string().min(1)).optional(),
})
