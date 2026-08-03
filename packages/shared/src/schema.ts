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
  fraction: z.number().min(0).max(1).optional(),
  segmentStartFraction: z.number().min(0).max(1).optional(),
})

export const readingRecordCreateSchema = z.object({
  bookId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSeconds: z.number().int().min(1).max(4 * 3600),
  startedAt: z.number().int().positive().optional(),
})

export const readingRecordRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const readingRecordHourlySchema = readingRecordRangeSchema.extend({
  // Client timezone offset in minutes behind UTC (Date#getTimezoneOffset)
  tzOffset: z.coerce.number().int().min(-840).max(840).default(0),
  bookId: z.string().min(1).optional(),
})

export const settingsUpdateSchema = z.object({
  uiTheme: z.enum(['system', 'light', 'dark']).optional(),
  readingThemeId: z.enum(['paper', 'sepia', 'night', 'cream']).optional(),
  lightReadingThemeId: z.enum(['paper', 'sepia', 'night', 'cream']).optional(),
  fontFamily: z.enum(['serif', 'sans-serif', 'kaiti', 'fangsong']).optional(),
  fontSize: z.number().min(12).max(64).optional(),
  fontWeight: z.number().min(100).max(900).optional(),
  lineHeight: z.number().min(1.2).max(2.5).optional(),
  paragraphSpacing: z.number().min(0).max(3).optional(),
  letterSpacing: z.number().min(-1).max(3).optional(),
  indent: z.number().min(0).max(4).optional(),
  pageWidth: z.number().min(0).max(1800).optional(),
  verticalPadding: z.number().min(0).max(120).optional(),
  horizontalPadding: z.number().min(0).max(120).optional(),
  scrollPageWidth: z.number().min(0).max(1800).optional(),
  scrollHorizontalPadding: z.number().min(0).max(120).optional(),
  scrollVerticalPadding: z.number().min(0).max(120).optional(),
  pagePageWidth: z.number().min(0).max(1800).optional(),
  pageHorizontalPadding: z.number().min(0).max(120).optional(),
  pageVerticalPadding: z.number().min(0).max(120).optional(),
  textAlignJustify: z.boolean().optional(),
  overrideBookFont: z.boolean().optional(),
  overrideBookLayout: z.boolean().optional(),
  coverMode: z.boolean().optional(),
  coverFit: z.boolean().optional(),
  gridColumns: z.string().optional(),
  toolbarLocked: z.boolean().optional(),
  sidebarWidth: z.number().min(200).max(500).optional(),
  readingMode: z.enum(['scroll', 'page']).optional(),
  pageColumns: z.number().int().min(1).max(3).optional(),
  columnGap: z.number().min(0).max(15).optional(),
  showHeader: z.boolean().optional(),
  showFooter: z.boolean().optional(),
  chineseConversion: z.enum(['off', 'simplified', 'traditional']).optional(),
  showWordCount: z.boolean().optional(),
  continuousScroll: z.enum(['off', 'snap', 'seamless']).optional(),
  pageAnimation: z.boolean().optional(),
  trash: z.object({
    autoCleanDays: z.union([z.literal(0), z.literal(7), z.literal(30)]),
  }).optional(),
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

export const registerSchema = z.object({
  username: z.string().min(1).max(30),
  password: z.string().min(6).max(256),
})

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(256),
  newPassword: z.string().min(6).max(256),
})

export const updateInstanceSchema = z.object({
  allowRegistration: z.boolean().optional(),
  allowGuestAccess: z.boolean().optional(),
})

export const updateUserSchema = z.object({
  role: z.enum(['owner', 'member']).optional(),
  disabled: z.boolean().optional(),
  newPassword: z.string().min(6).max(256).optional(),
})

export const shelfCreateSchema = z.object({ name: z.string().min(1).max(100) })
export const shelfUpdateSchema = z.object({ name: z.string().min(1).max(100) })
export const tagCreateSchema = z.object({ name: z.string().min(1).max(100) })
export const tagUpdateSchema = z.object({ name: z.string().min(1).max(100) })
export const bookMembershipSchema = z.object({
  shelfIds: z.array(z.string().min(1)).optional(),
  tagIds: z.array(z.string().min(1)).optional(),
})

export const bookMetadataSchema = z.object({
  publisher: z.string().max(200).optional(),
  published: z.string().max(50).optional(),
  isbn: z.string().max(20).optional(),
  identifier: z.string().max(100).optional(),
  language: z.string().max(20).optional(),
  subjects: z.array(z.string().max(100)).max(20).optional(),
  description: z.string().max(5000).optional(),
  series: z.string().max(200).optional(),
  seriesIndex: z.number().optional(),
})

export const bookUpdateSchema = z.object({
  readStatus: z.enum(['wishlist', 'reading', 'idle', 'finished', 'abandoned']).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  pinned: z.boolean().optional(),
  title: z.string().min(1).max(500).optional(),
  author: z.string().max(500).optional(),
  bookmeta: bookMetadataSchema.optional(),
})
