import type { BookFormat, ReadStatus } from './constants'

export interface User {
  id: string
  username: string
  passwordHash: string | null
  role: 'owner' | 'member' | 'guest'
  createdAt: number
}

export interface Book {
  id: string
  userId: string
  title: string
  author: string
  format: BookFormat
  filePath: string
  coverKey: string | null
  size: number
  meta: Record<string, unknown>
  createdAt: number
  updatedAt: number
  readStatus: ReadStatus
  lastReadAt?: number | null
  deletedAt: number | null
}

export interface Shelf {
  id: string
  userId: string
  name: string
  sortOrder: number
  createdAt: number
}

export interface BookShelf {
  bookId: string
  shelfId: string
  sortOrder: number
}

export interface Tag {
  id: string
  userId: string
  name: string
}

export interface BookTag {
  bookId: string
  tagId: string
}

export interface ReadingProgress {
  id: string
  userId: string
  bookId: string
  cfi: string | null
  chapter: string | null
  percent: number
  updatedAt: number
}

export interface Settings {
  id: string
  userId: string
  key: string
  value: unknown
}

export interface ReadingRecord {
  id: string
  userId: string
  bookId: string
  /** Local calendar day of the session start, 'YYYY-MM-DD' */
  date: string
  durationSeconds: number
}

export type AnnotationType = 'highlight' | 'note' | 'bookmark'

export type AnnotationStyle = 'underline' | 'squiggly' | 'highlight'

export interface Annotation {
  id: string
  userId: string
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
