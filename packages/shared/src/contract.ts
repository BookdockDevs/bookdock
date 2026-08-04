import type { BookFormat, ReadStatus } from './constants'
import type { ErrorCode } from './errors'
import type { AnnotationStyle, AnnotationType, ViewSettings } from './domain'

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
  /** True when the server injected the default user for guest access (no real session). */
  guest?: boolean
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
  fontFamily?: 'serif' | 'sans-serif' | 'kaiti' | 'fangsong'
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
  trash?: TrashSettings
}

export interface SettingsUpdateReq {
  settings: SettingsRes
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
  shelfIds?: string[]
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

export interface ReadingProgressUpdateReq {
  cfi?: string
  chapter?: string
  percent: number
  /** Book-wide position 0-1 reported by the reader engine */
  fraction?: number
  /** Start fraction of the current uninterrupted reading segment */
  segmentStartFraction?: number
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
  updatedAt: number
}

export interface ReadingRecordCreateReq {
  bookId: string
  /** Local calendar day of the session start, 'YYYY-MM-DD' */
  date: string
  durationSeconds: number
  /** Unix ms when the session block started; defaults to server receive time */
  startedAt?: number
}

export interface ReadingRecordSummaryRes {
  totalSeconds: number
  totalBooks: number
  totalDays: number
  todaySeconds: number
  currentStreak: number
  longestStreak: number
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
