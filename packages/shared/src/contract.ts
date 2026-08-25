import type { BookFormat, ReadStatus } from './constants'
import type { ErrorCode } from './errors'
import type { AnnotationStyle, AnnotationType, TocRulePattern, TransformMatchType, TransformScope, ViewSettings } from './domain'

export interface ApiResponse<T> {
  data: T
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message: string
    details?: unknown
  }
}

export interface PaginatedResponse<T> {
  data: T[]
  page: number
  pageSize: number
  total: number
}

export interface HealthCheckRes {
  ok: true
}

export interface LoginReq {
  username: string
  password: string
}

export interface LoginRes {
  token: string
  user: {
    id: string
    username: string
    role: string
  }
}

export interface SetupReq {
  username: string
  password: string
}

export interface SetupRes {
  token: string
  user: {
    id: string
    username: string
    role: string
  }
}

export interface SetupRequiredRes {
  required: boolean
}

export interface MeRes {
  id: string
  username: string
  role: string
  /** Content-hash addressed avatar blob key; the client builds the file URL as `/api/v1/avatars/<avatarKey>` */
  avatarKey: string | null
  /** True when the server injected the default user for guest access (no real session). */
  guest?: boolean
}

export interface UpdateUsernameReq {
  username: string
}

/** Account-mutation responses (username change, avatar upload): the fresh self profile */
export interface AccountRes {
  id: string
  username: string
  role: string
  avatarKey: string | null
}

export interface InstanceInfoRes {
  initialized: boolean
  allowRegistration: boolean
  allowGuestAccess: boolean
}

export interface UpdateInstanceReq {
  allowRegistration?: boolean
  allowGuestAccess?: boolean
}

export interface RegisterReq {
  username: string
  password: string
}

export interface RegisterRes {
  token: string
  user: {
    id: string
    username: string
    role: string
  }
}

export interface ChangePasswordReq {
  oldPassword: string
  newPassword: string
}

export interface AdminUserRes {
  id: string
  username: string
  role: 'owner' | 'member' | 'guest'
  disabled: boolean
  createdAt: number
  bookCount: number
}

export interface UpdateUserReq {
  role?: 'owner' | 'member'
  disabled?: boolean
  newPassword?: string
}

export interface TrashSettings {
  /** Days a trashed book is kept before auto-purge; 0 disables auto-clean */
  autoCleanDays: 0 | 7 | 30
}

export interface SettingsRes {
  uiTheme?: 'system' | 'light' | 'dark'
  readingThemeId?: 'paper' | 'sepia' | 'night' | 'cream'
  lightReadingThemeId?: 'paper' | 'sepia' | 'night' | 'cream'
  /** Open font id (system stack / builtin CDN / uploaded font id), resolved client-side */
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  lineHeight?: number
  paragraphSpacing?: number
  letterSpacing?: number
  indent?: number
  pageWidth?: number
  verticalPadding?: number
  horizontalPadding?: number
  // Per-mode backing values for the three layout settings above; the flat
  // fields mirror whichever readingMode is active.
  scrollPageWidth?: number
  scrollHorizontalPadding?: number
  scrollVerticalPadding?: number
  pagePageWidth?: number
  pageHorizontalPadding?: number
  pageVerticalPadding?: number
  textAlignJustify?: boolean
  overrideBookFont?: boolean
  overrideBookLayout?: boolean
  coverMode?: boolean
  coverFit?: boolean
  gridColumns?: string
  toolbarLocked?: boolean
  sidebarWidth?: number
  readingMode?: 'scroll' | 'page'
  pageColumns?: number
  columnGap?: number
  showHeader?: boolean
  showFooter?: boolean
  chineseConversion?: 'off' | 'simplified' | 'traditional'
  showWordCount?: boolean
  continuousScroll?: 'off' | 'snap' | 'seamless'
  pageAnimation?: boolean
  /** Reading-time accounting: automatic heuristics, manual timer pill, or off (no reading data) */
  readingTimerMode?: 'auto' | 'manual' | 'off'
  manualTimerGraceMinutes?: 1 | 5 | 10 | 30
  trash?: TrashSettings
  /**
   * Named reading-setting profiles (global config + presets + active pointer),
   * serialized as JSON by the web client and passed through by the server.
   */
  readingConfig?: string
  /**
   * User-created reading themes, serialized as JSON by the web client.
   * Synced because reading configs reference custom themes by id.
   */
  customThemes?: string
}

export interface SettingsUpdateReq {
  settings: SettingsRes
}

export type FontScope = 'user' | 'instance'

export interface FontListItem {
  id: string
  /** Family name parsed from the sfnt name table, falling back to the file name */
  family: string
  fileName: string
  format: 'ttf' | 'otf' | 'woff' | 'woff2'
  size: number
  scope: FontScope
  /** True when the requesting user uploaded this font */
  mine: boolean
  createdAt: number
}

export interface ShelfListItem {
  id: string
  userId: string
  name: string
  sortOrder: number
  createdAt: number
  bookCount: number
}

export interface ShelfCreateReq {
  name: string
}

export interface ShelfUpdateReq {
  name: string
}

/** Full ordered shelf id list; the server rewrites each shelf's sortOrder to its index. */
export interface ShelfReorderReq {
  shelfIds: string[]
}

export interface TagListItem {
  id: string
  userId: string
  name: string
  bookCount: number
}

export interface TagCreateReq {
  name: string
}

export interface TagUpdateReq {
  name: string
}

export interface BookMembershipReq {
  /** Single-shelf membership: string = move into shelf, null = remove from shelf, absent = unchanged */
  shelfId?: string | null
  tagIds?: string[]
}

export interface BookListItem {
  id: string
  title: string
  author: string
  format: BookFormat
  coverKey: string | null
  size: number
  readStatus: ReadStatus
  progress: number | null
  pinnedAt?: number | null
  lastReadAt?: number | null
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
  /** Single-shelf membership; null = uncategorized. Drives drag-to-shelf no-op checks. */
  shelfId: string | null
  /** Resolved shelf name (null when uncategorized); list view info line only */
  shelfName?: string | null
  /** Tag names attached to the book; list view info line only */
  tags?: string[]
}

export interface BookMetadata {
  publisher?: string
  published?: string
  isbn?: string
  identifier?: string
  language?: string
  subjects?: string[]
  description?: string
  series?: string
  seriesIndex?: number
}

export interface BookMeta {
  chapters?: Chapter[]
  bookmeta?: BookMetadata
  /** Total word count of the book (sum of chapter word counts) */
  wordCount?: number
  /** Per-book reading-setting overrides (F1), see ViewSettings */
  viewSettings?: ViewSettings
  /** Reading preset bound to this book (reading-profile id); a dangling id
   * (preset deleted) falls back to the device resolution chain */
  boundPresetId?: string
  /** TOC rule pinned to this book (id); dangling id falls back to auto-scoring
   * then the legacy hardcoded patterns. `tocRuleAuto` records that the pin was
   * chosen by auto-scoring (titled + lazy-reprocessed), not by the user. */
  tocRuleId?: string
  tocRuleAuto?: boolean
}

export interface BookDetailRes extends BookListItem {
  filePath: string
  meta: BookMeta
}

export interface Chapter {
  id: string
  title: string
  level: number
  startOffset: number
  endOffset: number
  contentStartOffset?: number
  wordCount?: number
}

export interface ChapterListRes {
  data: Chapter[]
}

export interface UploadBookRes {
  id: string
  title: string
  format: BookFormat
  size: number
}

/** POST /books response: `duplicated` is true when the upload hit content-hash dedup
 * and the existing book row was returned instead of creating a new one. */
export interface BookUploadRes {
  data: BookListItem
  duplicated: boolean
}

/** A reading-speed sample: book-wide position at a wall-clock time (unix ms) */
export interface RateSample {
  fraction: number
  at: number
}

export interface ReadingProgressUpdateReq {
  cfi?: string
  chapter?: string
  percent: number
  /** Book-wide position 0-1 reported by the reader engine */
  fraction?: number
  /** Start fraction of the current uninterrupted reading segment */
  segmentStartFraction?: number
  /** Speed sample from a continuous reading stretch (client-side filtered) */
  sample?: RateSample
}

export interface ReadingProgressRes {
  id: string
  bookId: string
  cfi: string | null
  chapter: string | null
  percent: number
  fraction?: number | null
  /** Total union length of read intervals, 0-1; absent for legacy progress not yet re-saved */
  readFraction?: number
  /** Sliding window of reading-speed samples (most recent last) */
  rateSamples?: RateSample[]
  updatedAt: number
}

export interface ReadingRecordCreateReq {
  bookId: string
  /** Local calendar day of the session start, 'YYYY-MM-DD' */
  date: string
  durationSeconds: number
  /** Unix ms when the session block started; defaults to server receive time.
   * Explicit null = retroactive entry without a known start time (endedAt then required) */
  startedAt?: number | null
  /** Manual-mode sessions only: exact end time and bounds in every display unit */
  endedAt?: number
  startCfi?: string
  endCfi?: string
  /** Book-wide position 0-1 (percent is derived by ×100 at display time) */
  startFraction?: number
  endFraction?: number
  startChapterIndex?: number
  endChapterIndex?: number
}

/** One row of the per-book session list; auto-mode blocks have null bounds */
export interface ReadingSessionItem {
  id: string
  bookId: string
  /** Client-local calendar day of the session start, 'YYYY-MM-DD' */
  date: string
  startedAt: number
  durationSeconds: number
  endedAt: number | null
  startCfi: string | null
  endCfi: string | null
  startFraction: number | null
  endFraction: number | null
  startChapterIndex: number | null
  endChapterIndex: number | null
}

export interface ReadingSessionUpdateReq {
  durationSeconds?: number
  startedAt?: number
  endedAt?: number
  date?: string
  startFraction?: number
  endFraction?: number
  startChapterIndex?: number
  endChapterIndex?: number
  startCfi?: string
  endCfi?: string
}

export interface ReadingRecordSummaryRes {
  totalSeconds: number
  totalBooks: number
  totalDays: number
  todaySeconds: number
  currentStreak: number
  longestStreak: number
  /** This calendar week (Mon–today) vs the previous full week, client-local days */
  weekSeconds: number
  prevWeekSeconds: number
  /** This calendar month (1st–today) vs the previous full month, client-local days */
  monthSeconds: number
  prevMonthSeconds: number
  /** Sum over books of readFraction × wordCount, rounded */
  totalWordsRead: number
}

export interface ReadingRecordDailyItem {
  date: string
  durationSeconds: number
}

export interface ReadingRecordHourlyItem {
  /** Client-local hour of day, 0-23 */
  hour: number
  durationSeconds: number
}

export interface ReadingRecordBookItem {
  bookId: string
  title: string
  author: string
  coverKey: string | null
  progress: number
  durationSeconds: number
  /** Distinct days with recorded reading in the range */
  days: number
  readStatus: ReadStatus
}

export interface ReadingRecordBookDetailRes {
  totalSeconds: number
  records: ReadingRecordDailyItem[]
}

/** Manual session row of the per-book mixed detail feed (same fields as the session list) */
export interface ReadingDetailManualItem extends Omit<ReadingSessionItem, 'startedAt'> {
  kind: 'manual'
  /** Null for retroactive entries recorded without a start time */
  startedAt: number | null
}

/** Auto-mode day row of the mixed detail feed: the day's total minus its manual sessions */
export interface ReadingDetailAutoDayItem {
  kind: 'autoDay'
  /** Client-local calendar day, 'YYYY-MM-DD' */
  date: string
  durationSeconds: number
}

export type ReadingDetailItem = ReadingDetailManualItem | ReadingDetailAutoDayItem

export interface ReadingRecordTagItem {
  tagId: string
  name: string
  durationSeconds: number
}

export type TransformCreateReq = {
  /**
   * Pattern rules with a bookId are book-scoped ("all matches in this book");
   * without it they are user-global. Point patches are inherently
   * single-book: bookId is required.
   */
  bookId?: string | null
  matchType?: TransformMatchType
  pattern?: string
  /** Null/empty = delete (hide) the matched content */
  replacement?: string | null
  isRegex?: boolean
  caseSensitive?: boolean
  enabled?: boolean
  name?: string
  group?: string
  spineHref?: string
  textOffset?: number
  originalText?: string
}

export type TransformUpdateReq = {
  name?: string | null
  group?: string | null
  pattern?: string
  replacement?: string | null
  isRegex?: boolean
  caseSensitive?: boolean
  enabled?: boolean
  /** Type conversion: point → pattern only (the snapshot becomes the pattern).
   *  pattern → point is rejected — point patches need anchors from a selection. */
  matchType?: TransformMatchType
  /** Scope conversion: null = user-global; a value = bind to a book */
  bookId?: string | null
  /** Point-patch snapshot edit (anchor offset is kept where the user selected) */
  originalText?: string
}

export interface TextTransformRes {
  id: string
  /** Null = user-global pattern rule; set = book-scoped (point patches always carry their book) */
  bookId: string | null
  scope: TransformScope
  matchType: TransformMatchType
  pattern: string | null
  replacement: string | null
  isRegex: boolean
  caseSensitive: boolean
  /** Global default switch: applies to every book unless overridden per book */
  enabled: boolean
  /** Effective value for the queried book after applying its override; only set on `GET /transforms?bookId=` */
  effectiveEnabled?: boolean | null
  /** Whether a per-book override row exists; only set on `GET /transforms?bookId=` */
  hasOverride?: boolean
  name: string | null
  group: string | null
  spineHref: string | null
  textOffset: number | null
  originalText: string | null
  createdAt: number
  updatedAt: number
}

/** Per-book override for a pattern rule: boolean upserts the override, null deletes it (restore inheritance) */
export type TransformOverrideReq = {
  bookId: string
  enabled: boolean | null
}

export type TocRuleCreateReq = {
  name: string
  enabled?: boolean
  sortOrder?: number
  patterns: TocRulePattern[]
}

export type TocRuleUpdateReq = {
  name?: string
  enabled?: boolean
  sortOrder?: number
  patterns?: TocRulePattern[]
}

export type TocRuleReorderReq = {
  tocRuleIds: string[]
}

export interface TocRuleRes {
  id: string
  name: string
  enabled: boolean
  sortOrder: number
  patterns: TocRulePattern[]
  createdAt: number
  updatedAt: number
}

export interface TocRuleListRes {
  data: TocRuleRes[]
}

export type AnnotationCreateReq = {
  cfiRange: string
  cfiAnchor?: string
  type: AnnotationType
  color?: string
  style?: AnnotationStyle
  text?: string
  note?: string
  chapter?: string
}

export type AnnotationUpdateReq = {
  color?: string
  style?: AnnotationStyle
  note?: string
  text?: string
}

export interface AnnotationRes {
  id: string
  bookId: string
  cfiRange: string
  cfiAnchor: string | null
  type: AnnotationType
  color: string
  style: AnnotationStyle
  text: string
  note: string | null
  chapter: string | null
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}
