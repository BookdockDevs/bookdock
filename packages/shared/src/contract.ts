import type { BookFormat } from './constants'
import type { ErrorCode } from './errors'
import type { AnnotationStyle, AnnotationType } from './domain'

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
  pageWidth?: 'auto' | 640 | 800 | 900 | 1000 | 1280
  verticalPadding?: number
  horizontalPadding?: number
  textAlignJustify?: boolean
  overrideBookFont?: boolean
  overrideBookLayout?: boolean
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
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}

export interface BookDetailRes extends BookListItem {
  filePath: string
  meta: Record<string, unknown>
}

export interface Chapter {
  id: string
  title: string
  level: number
  startOffset: number
  endOffset: number
  contentStartOffset?: number
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

export interface ReadingProgressUpdateReq {
  cfi?: string
  chapter?: string
  percent: number
}

export interface ReadingProgressRes {
  id: string
  bookId: string
  cfi: string | null
  chapter: string | null
  percent: number
  updatedAt: number
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
}
