import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash'),
  role: text('role', { enum: ['owner', 'member', 'guest'] }).notNull().default('owner'),
  disabled: integer('disabled').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at'),
})

export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  author: text('author').notNull().default(''),
  format: text('format', { enum: ['epub', 'txt'] }).notNull(),
  filePath: text('file_path').notNull(),
  coverKey: text('cover_key'),
  contentHash: text('content_hash'),
  size: integer('size').notNull(),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  readStatus: text('read_status', { enum: ['wishlist', 'reading', 'idle', 'finished', 'abandoned'] }).notNull().default('reading'),
  progress: integer('progress').notNull().default(0),
  pinnedAt: integer('pinned_at'),
  lastReadAt: integer('last_read_at'),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  userDeletedIdx: index('books_user_deleted_idx').on(table.userId, table.deletedAt),
  contentHashIdx: index('books_content_hash_idx').on(table.contentHash),
}))

export const shelves = sqliteTable('shelves', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

export const bookShelves = sqliteTable('book_shelves', {
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  shelfId: text('shelf_id').notNull().references(() => shelves.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.bookId, table.shelfId] }),
  shelfIdx: index('book_shelves_shelf_idx').on(table.shelfId),
}))

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
})

export const bookTags = sqliteTable('book_tags', {
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.bookId, table.tagId] }),
  tagIdx: index('book_tags_tag_idx').on(table.tagId),
}))

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  key: text('key').notNull(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
}, (table) => ({
  userKeyIdx: uniqueIndex('settings_user_key_idx').on(table.userId, table.key),
}))

export const instanceSettings = sqliteTable('instance_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const annotations = sqliteTable('annotations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  cfiRange: text('cfi_range').notNull(),
  cfiAnchor: text('cfi_anchor'),
  type: text('type', { enum: ['highlight', 'note', 'bookmark'] }).notNull(),
  color: text('color').notNull().default('yellow'),
  style: text('style', { enum: ['underline', 'squiggly', 'highlight'] }).notNull().default('underline'),
  text: text('text').notNull().default(''),
  note: text('note'),
  chapter: text('chapter'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  // Notes are exempt: rereads produce new ideas on the same range over time
  userBookCfiTypeIdx: uniqueIndex('annotation_user_book_cfi_type_idx')
    .on(table.userId, table.bookId, table.cfiRange, table.type)
    .where(sql`${table.type} != 'note'`),
}))

export const readingRecords = sqliteTable('reading_records', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  // Client-local calendar day of the session start ('YYYY-MM-DD'), one row per user+book+day
  date: text('date').notNull(),
  durationSeconds: integer('duration_seconds').notNull().default(0),
}, (table) => ({
  userBookDateIdx: uniqueIndex('reading_records_user_book_date_idx').on(table.userId, table.bookId, table.date),
  userDateIdx: index('reading_records_user_date_idx').on(table.userId, table.date),
}))

// Fine-grained session detail: one row per reported reading block, kept for
// hour-of-day distribution stats. reading_records stays the daily aggregate.
export const readingSessions = sqliteTable('reading_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  // Client-local calendar day of the session start ('YYYY-MM-DD')
  date: text('date').notNull(),
  startedAt: integer('started_at').notNull(),
  durationSeconds: integer('duration_seconds').notNull().default(0),
}, (table) => ({
  userDateIdx: index('reading_sessions_user_date_idx').on(table.userId, table.date),
}))
