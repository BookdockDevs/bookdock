import { z } from 'zod'
import { AI_MAX_ASSISTANT_MODES, AI_MAX_CHAT_PROMPT_CHARS, AI_MAX_CHAPTER_REFERENCES, AI_MAX_CONTEXT_CHARS, AI_MAX_INDEX_CORPUS_CHARS, AI_READING_SCOPES, AI_TOOL_NAMES, PAGINATION } from './constants'

export const bookFormatSchema = z.enum(['epub', 'txt'])

// Fields configurable per position on the header/footer info bar (F4).
export const marginalFieldSchema = z.enum(['none', 'bookTitle', 'chapter', 'chapterProgress', 'bookProgress', 'chapterWordCount', 'time'])

// Click-to-turn zones (F3 rework): 'none' = no mode selected = disabled.
export const clickAreaModeSchema = z.enum(['standard', 'fullscreen', 'swap', 'none'])

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
  chapterIndex: z.number().int().min(-1).max(1_000_000).optional(),
  percent: z.number().min(0).max(100),
  fraction: z.number().min(0).max(1).optional(),
  segmentStartFraction: z.number().min(0).max(1).optional(),
  sample: z.object({
    fraction: z.number().min(0).max(1),
    at: z.number().int().positive(),
  }).optional(),
})

export const readingRecordCreateSchema = z.object({
  bookId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSeconds: z.number().int().min(1).max(24 * 3600),
  // Explicit null = retroactive manual entry without a known start time
  // (hour-of-day stats skip it); omitted = server receive time
  startedAt: z.number().int().positive().nullish(),
  // Manual-mode sessions (manual reading timer) only: exact end time and the
  // progress interval boundaries in every display unit — cfi anchor, fraction
  // (0-1; percent is derived) and chapter index; auto-mode blocks leave them
  // unset
  endedAt: z.number().int().positive().optional(),
  startCfi: z.string().min(1).optional(),
  endCfi: z.string().min(1).optional(),
  startFraction: z.number().min(0).max(1).optional(),
  endFraction: z.number().min(0).max(1).optional(),
  startChapterIndex: z.number().int().min(0).optional(),
  endChapterIndex: z.number().int().min(0).optional(),
}).refine((v) => v.startedAt !== null || v.endedAt !== undefined, {
  // A retroactive entry without any time must still be an ended (editable,
  // listed) manual session, not an immutable auto-mode block
  message: 'endedAt is required when startedAt is null',
  path: ['endedAt'],
}).refine((v) => v.startFraction === undefined || v.endFraction === undefined || v.endFraction >= v.startFraction, {
  message: 'endFraction must be >= startFraction',
  path: ['endFraction'],
})

export const readingSessionUpdateSchema = z.object({
  durationSeconds: z.number().int().min(1).max(24 * 3600).optional(),
  startedAt: z.number().int().positive().optional(),
  endedAt: z.number().int().positive().optional(),
  // Client-local calendar day of the (possibly new) session start; required
  // when startedAt changes so the daily aggregate is re-attributed correctly
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startFraction: z.number().min(0).max(1).optional(),
  endFraction: z.number().min(0).max(1).optional(),
  startChapterIndex: z.number().int().min(0).optional(),
  endChapterIndex: z.number().int().min(0).optional(),
  startCfi: z.string().min(1).optional(),
  endCfi: z.string().min(1).optional(),
}).refine((v) => v.startedAt === undefined || v.endedAt === undefined || v.endedAt >= v.startedAt, {
  message: 'endedAt must be after startedAt',
  path: ['endedAt'],
}).refine((v) => v.startFraction === undefined || v.endFraction === undefined || v.endFraction >= v.startFraction, {
  message: 'endFraction must be >= startFraction',
  path: ['endFraction'],
})

export const readingSessionListSchema = z.object({
  bookId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const readingDetailListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
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
  // Open font id: system stack ids (serif/sans-serif/kaiti/fangsong), builtin CDN
  // font ids, or uploaded font ids — resolved client-side against the font registry.
  fontFamily: z.string().min(1).max(100).optional(),
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
  coverText: z.boolean().optional(),
  coverFit: z.enum(['crop', 'full']).optional(),
  gridColumns: z.string().optional(),
  toolbarLocked: z.boolean().optional(),
  sidebarWidth: z.number().min(200).max(500).optional(),
  readingMode: z.enum(['scroll', 'page']).optional(),
  pageColumns: z.number().int().min(1).max(3).optional(),
  columnGap: z.number().min(0).max(15).optional(),
  showHeader: z.boolean().optional(),
  showFooter: z.boolean().optional(),
  chineseConversion: z.enum(['off', 'simplified', 'traditional']).optional(),
  continuousScroll: z.enum(['off', 'snap', 'seamless']).optional(),
  pageAnimation: z.boolean().optional(),
  autoMarkSelection: z.boolean().optional(),
  clickAreaMode: clickAreaModeSchema.optional(),
  headerLeft: marginalFieldSchema.optional(),
  headerCenter: marginalFieldSchema.optional(),
  headerRight: marginalFieldSchema.optional(),
  footerLeft: marginalFieldSchema.optional(),
  footerCenter: marginalFieldSchema.optional(),
  footerRight: marginalFieldSchema.optional(),
  marginalFontSize: z.number().min(0).max(24).optional(),
  readingTimerMode: z.enum(['auto', 'manual', 'off']).optional(),
  manualTimerGraceMinutes: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(30)]).optional(),
  ttsEngine: z.enum(['system', 'edge', 'service']).optional(),
  ttsServiceId: z.string().nullable().optional(),
  ttsVoiceId: z.string().max(200).optional(),
  ttsRate: z.number().min(0.5).max(3).optional(),
  ttsAutoNext: z.boolean().optional(),
  ttsFollow: z.boolean().optional(),
  // Named reading-setting profiles; JSON serialized by the web client, server passes it through.
  readingConfig: z.string().optional(),
  customThemes: z.string().optional(),
  trash: z.object({
    autoCleanDays: z.union([z.literal(0), z.literal(7), z.literal(30)]),
  }).optional(),
})

const ttsBaseUrlSchema = z.string().url().max(500).refine((value) => /^https?:\/\//i.test(value), 'Only HTTP(S) URLs are supported')
const ttsProviderSchema = z.enum(['openai', 'azure', 'aliyun', 'dashscope', 'minimax', 'mimo', 'volcengine', 'openai-compatible'])
const ttsOptionsSchema = z.record(z.union([z.string().max(500), z.number().finite(), z.boolean()])).refine((value) => Object.keys(value).length <= 20)
const ttsSecretsSchema = z.record(z.string().max(4096).nullable()).refine((value) => Object.keys(value).length <= 20)

export const ttsServiceCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  provider: ttsProviderSchema,
  baseUrl: ttsBaseUrlSchema.nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  defaultVoice: z.string().trim().max(200).nullable().optional(),
  options: ttsOptionsSchema.optional(),
  secrets: z.record(z.string().max(4096)).refine((value) => Object.keys(value).length <= 20).optional(),
})

export const ttsServiceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  provider: ttsProviderSchema.optional(),
  baseUrl: ttsBaseUrlSchema.nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  defaultVoice: z.string().trim().max(200).nullable().optional(),
  options: ttsOptionsSchema.optional(),
  secrets: ttsSecretsSchema.optional(),
})

export const ttsSpeechSchema = z.object({
  serviceId: z.string().min(1),
  text: z.string().trim().min(1).max(4000),
  voice: z.string().max(200).optional(),
  rate: z.number().min(0.25).max(4).optional(),
})

export const ttsEdgeSpeechSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  voice: z.string().max(200).optional(),
  rate: z.number().min(0.5).max(2).optional(),
})

const aiContextSchema = z.object({
  chapterIndex: z.number().int().min(-1).max(1_000_000),
  chapterTitle: z.string().max(500).optional(),
  cfiRange: z.string().trim().min(1).max(2000),
  selection: z.string().trim().max(AI_MAX_CONTEXT_CHARS),
  before: z.string().max(2000).optional(),
  paragraph: z.string().max(8_000).optional(),
  visibleTextVersion: z.string().trim().min(1).max(200).optional(),
  chapterReferences: z.array(z.object({
    chapterIndex: z.number().int().min(0).max(1_000_000),
    chapterTitle: z.string().max(500).optional(),
    text: z.string().trim().min(1).max(AI_MAX_CONTEXT_CHARS),
  }).strict()).max(AI_MAX_CHAPTER_REFERENCES).optional(),
}).strict()

const aiHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(8000),
  context: aiContextSchema.optional(),
}).strict()

const aiToolNameSchema = z.enum(AI_TOOL_NAMES)
const aiReadingScopeSchema = z.enum(AI_READING_SCOPES)
const aiThreadSettingsSchema = z.object({
  readingScope: aiReadingScopeSchema,
  enabledTools: z.array(aiToolNameSchema).max(AI_TOOL_NAMES.length),
  assistantModeId: z.string().trim().min(1).max(100).optional(),
}).strict()

export const aiChatSchema = z.object({
  bookId: z.string().trim().min(1).max(200),
  threadId: z.string().trim().min(1).max(100).optional(),
  regenerate: z.boolean().optional(),
  editMessageId: z.string().trim().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).max(AI_MAX_CHAT_PROMPT_CHARS),
  context: aiContextSchema,
  history: z.array(aiHistoryMessageSchema).max(12).optional(),
  assistantModePrompt: z.string().trim().max(2_000).optional(),
  assistantMode: z.string().trim().max(80).optional(),
  assistantModeId: z.string().trim().min(1).max(100).optional(),
  readingScope: aiReadingScopeSchema.optional(),
  enabledTools: z.array(aiToolNameSchema).max(AI_TOOL_NAMES.length).optional(),
}).strict()

const aiThreadTitleSchema = z.string().trim().min(1).max(100)

export const aiThreadCreateSchema = z.object({
  bookId: z.string().trim().min(1).max(200),
  title: aiThreadTitleSchema.optional(),
  settings: aiThreadSettingsSchema.optional(),
}).strict()

export const aiThreadUpdateSchema = z.object({
  title: aiThreadTitleSchema.optional(),
  settings: aiThreadSettingsSchema.optional(),
}).strict().refine((value) => value.title !== undefined || value.settings !== undefined, 'At least one AI thread field is required')

export const aiThreadListSchema = z.object({
  bookId: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict()

export const aiGenerationRunIdSchema = z.string().trim().min(1).max(100)

export const aiMessageIdSchema = z.string().trim().min(1).max(100)

export const aiIndexStatusSchema = z.object({
  bookId: z.string().trim().min(1).max(200),
}).strict()

export const aiIndexSchema = z.object({
  bookId: z.string().trim().min(1).max(200),
  force: z.boolean().optional(),
  visibleTextVersion: z.string().trim().min(1).max(200).optional(),
  chapters: z.array(z.object({
    chapterIndex: z.number().int().min(0).max(1_000_000),
    text: z.string().max(1_000_000),
  }).strict()).max(10_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.chapters && !value.visibleTextVersion) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['visibleTextVersion'], message: 'visibleTextVersion is required with chapters' })
  }
  if (value.visibleTextVersion && !value.chapters) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['chapters'], message: 'chapters are required with visibleTextVersion' })
  }
  if (value.chapters) {
    const totalChars = value.chapters.reduce((total, chapter) => total + chapter.text.length, 0)
    if (totalChars > AI_MAX_INDEX_CORPUS_CHARS) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['chapters'], message: 'transformed corpus is too large' })
    }
    const indexes = new Set<number>()
    for (const chapter of value.chapters) {
      if (indexes.has(chapter.chapterIndex)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['chapters'], message: 'chapter indexes must be unique' })
        break
      }
      indexes.add(chapter.chapterIndex)
    }
  }
})

export const aiSearchSchema = z.object({
  bookId: z.string().trim().min(1).max(200),
  query: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(10).default(5),
  minChapterIndex: z.coerce.number().int().min(0).max(1_000_000).optional(),
  maxChapterIndex: z.coerce.number().int().min(-1).max(1_000_000).optional(),
}).strict()

const aiBaseUrlSchema = z.string().trim().min(1).max(2048).url().refine((value) => /^https?:\/\//i.test(value), 'Only HTTP(S) URLs are supported')

const aiModelCapabilitiesSchema = z.object({
  vision: z.boolean().optional(),
  tools: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  embedding: z.boolean().optional(),
}).strict()

const aiModelSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  ownedBy: z.string().trim().max(200).optional(),
  capabilities: aiModelCapabilitiesSchema.optional(),
}).strict()

const aiModelKindSchema = z.enum(['chat', 'embedding'])

const aiPromptTemplateSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(2_000),
  scope: z.enum(['selection', 'reading', 'both']).optional(),
  enabled: z.boolean().optional().default(true),
  order: z.number().int().min(0).max(10_000).optional().default(0),
}).strict()

const aiAssistantModeSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(2_000),
}).strict()

export const aiProviderSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'ollama',
  'lmstudio',
  'deepseek',
  'qwen',
  'glm',
  'moonshot',
  'openrouter',
  'siliconflow',
  'minimax',
  'mimo',
])

export const aiConfigUpdateSchema = z.object({
  activeProfileId: z.string().trim().max(100).nullable().optional(),
  embeddingProfileId: z.string().trim().max(100).nullable().optional(),
  embeddingModel: z.string().trim().min(1).max(200).nullable().optional(),
  prompts: z.array(aiPromptTemplateSchema).max(24).nullable().optional(),
  modes: z.array(aiAssistantModeSchema).max(AI_MAX_ASSISTANT_MODES).nullable().optional(),
  defaultAssistantMode: aiAssistantModeSchema.nullable().optional(),
  lastUsedConversationSettings: aiThreadSettingsSchema.required({ assistantModeId: true }).optional(),
}).strict()

export const aiProfileCreateSchema = z.object({
  name: z.string().trim().max(100),
  provider: aiProviderSchema,
  baseUrl: aiBaseUrlSchema.nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  models: z.array(aiModelSchema).max(200).optional(),
  embeddingModel: z.string().trim().max(200).nullable().optional(),
  embeddingModels: z.array(aiModelSchema).max(200).optional(),
  apiKey: z.string().max(4096).nullable().optional(),
}).strict()

export const aiProfileUpdateSchema = z.object({
  name: z.string().trim().max(100).optional(),
  provider: aiProviderSchema.optional(),
  baseUrl: aiBaseUrlSchema.nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  models: z.array(aiModelSchema).max(200).optional(),
  embeddingModel: z.string().trim().max(200).nullable().optional(),
  embeddingModels: z.array(aiModelSchema).max(200).optional(),
  apiKey: z.string().max(4096).nullable().optional(),
}).strict()

export const aiModelDiscoverySchema = z.object({
  profileId: z.string().trim().max(100).nullable().optional(),
  provider: aiProviderSchema,
  baseUrl: aiBaseUrlSchema.nullable().optional(),
  kind: aiModelKindSchema.optional(),
  apiKey: z.string().max(4096).nullable().optional(),
}).strict()

export const aiConfigTestSchema = z.object({
  profileId: z.string().trim().max(100).nullable().optional(),
  provider: aiProviderSchema,
  baseUrl: aiBaseUrlSchema.nullable().optional(),
  kind: aiModelKindSchema.optional().default('chat'),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(4096).nullable().optional(),
}).strict()

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

const transformFields = {
  // Null = user-global pattern rule; set = book-scoped (pattern "all matches in
  // this book"). Point patches require it.
  bookId: z.string().min(1).nullish(),
  matchType: z.enum(['pattern', 'point']).optional().default('pattern'),
  pattern: z.string().optional(),
  // Null/empty = delete (hide) the matched content
  replacement: z.string().nullish(),
  isRegex: z.boolean().optional().default(false),
  caseSensitive: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
  name: z.string().max(200).optional(),
  group: z.string().max(200).optional(),
  // Point-patch anchors (matchType 'point' only)
  spineHref: z.string().min(1).optional(),
  textOffset: z.number().int().min(0).optional(),
  originalText: z.string().optional(),
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

export const transformCreateSchema = z.object(transformFields)
  .refine((v) => v.matchType !== 'pattern' || (v.pattern !== undefined && v.pattern.length > 0), {
    message: 'pattern is required for pattern transforms',
    path: ['pattern'],
  })
  .refine((v) => v.matchType !== 'point' || (v.spineHref !== undefined && v.textOffset !== undefined && v.originalText !== undefined), {
    message: 'spineHref, textOffset and originalText are required for point transforms',
    path: ['spineHref'],
  })
  .refine((v) => v.matchType !== 'point' || (v.bookId !== undefined && v.bookId !== null), {
    message: 'bookId is required for point transforms',
    path: ['bookId'],
  })
  .refine((v) => !v.isRegex || v.pattern === undefined || isValidRegex(v.pattern), {
    message: 'pattern is not a valid regular expression',
    path: ['pattern'],
  })

export const transformUpdateSchema = z.object({
  name: z.string().max(200).nullable().optional(),
  group: z.string().max(200).nullable().optional(),
  pattern: z.string().min(1).optional(),
  replacement: z.string().nullable().optional(),
  isRegex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  enabled: z.boolean().optional(),
  // Type conversion: only pattern is reachable via update — point patches need
  // anchors from a text selection and are never created through this path
  matchType: z.enum(['pattern', 'point']).optional(),
  // Scope conversion: null = promote to user-global; a value = bind to a book
  bookId: z.string().min(1).nullable().optional(),
  // Point-patch snapshot edit (the anchor offset stays where the user selected)
  originalText: z.string().min(1).optional(),
})

export const transformOverrideSchema = z.object({
  bookId: z.string().min(1),
  // boolean = upsert the per-book override; null = delete it (restore inheritance)
  enabled: z.boolean().nullable(),
})

export const tocRulePatternSchema = z.object({
  level: z.number().int().min(1),
  regex: z.string().min(1),
  replacement: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
})

export const tocRuleCreateSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  patterns: z.array(tocRulePatternSchema).min(1),
}).refine((v) => v.patterns.every((p) => p.regex === undefined || isValidRegex(p.regex)), {
  message: 'pattern is not a valid regular expression',
  path: ['patterns'],
})

export const tocRuleUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  patterns: z.array(tocRulePatternSchema).min(1).optional(),
}).refine((v) => v.patterns === undefined || v.patterns.every((p) => p.regex === undefined || isValidRegex(p.regex)), {
  message: 'pattern is not a valid regular expression',
  path: ['patterns'],
})

export const tocRuleReorderSchema = z.object({
  tocRuleIds: z.array(z.string().min(1)),
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

export const updateUsernameSchema = z.object({
  username: z.string().min(1).max(30),
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
export const shelfReorderSchema = z.object({ shelfIds: z.array(z.string().min(1)) })
export const tagCreateSchema = z.object({ name: z.string().min(1).max(100) })
export const tagUpdateSchema = z.object({ name: z.string().min(1).max(100) })
export const bookMembershipSchema = z.object({
  shelfId: z.string().min(1).nullable().optional(),
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

export const viewSettingsSchema = z.object({
  fontSize: z.number().min(12).max(64).optional(),
  lineHeight: z.number().min(1.2).max(2.5).optional(),
  pageWidth: z.number().min(0).max(1800).optional(),
  horizontalPadding: z.number().min(0).max(120).optional(),
  verticalPadding: z.number().min(0).max(120).optional(),
  pageColumns: z.number().int().min(1).max(3).optional(),
  columnGap: z.number().min(0).max(15).optional(),
  scrollPageWidth: z.number().min(0).max(1800).optional(),
  scrollHorizontalPadding: z.number().min(0).max(120).optional(),
  scrollVerticalPadding: z.number().min(0).max(120).optional(),
  pagePageWidth: z.number().min(0).max(1800).optional(),
  pageHorizontalPadding: z.number().min(0).max(120).optional(),
  pageVerticalPadding: z.number().min(0).max(120).optional(),
})

export const bookUpdateSchema = z.object({
  readStatus: z.enum(['wishlist', 'reading', 'idle', 'finished', 'abandoned']).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  pinned: z.boolean().optional(),
  title: z.string().min(1).max(500).optional(),
  author: z.string().max(500).optional(),
  bookmeta: bookMetadataSchema.optional(),
  // null clears the per-book overrides (fall back to global)
  viewSettings: viewSettingsSchema.nullable().optional(),
  // null removes the preset binding (fall back to the device resolution chain)
  boundPresetId: z.string().nullable().optional(),
  // null removes the pinned TOC rule and restores automatic selection
  tocRuleId: z.string().nullable().optional(),
})
