// Historical bridge and upgrade fixtures only; never register in the active schema.
import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { users } from './schema'

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
  // Single-shelf membership; null = uncategorized (legitimate state)
  shelfId: text('shelf_id').references(() => shelves.id, { onDelete: 'set null' }),
}, (table) => ({
  userDeletedIdx: index('books_user_deleted_idx').on(table.userId, table.deletedAt),
  contentHashIdx: index('books_content_hash_idx').on(table.contentHash),
  shelfIdx: index('books_shelf_idx').on(table.shelfId),
}))

export const shelves = sqliteTable('shelves', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  // Membership-change time, maintained by DB triggers (0007), not service code
  updatedAt: integer('updated_at').notNull().default(0),
  // Sidebar pin-to-top flag, orthogonal to every sort mode (0007)
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
})

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull().default(0),
  // Membership-change time, maintained by DB triggers (0007), not service code
  updatedAt: integer('updated_at').notNull().default(0),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
})

export const bookTags = sqliteTable('book_tags', {
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.bookId, table.tagId] }),
  tagIdx: index('book_tags_tag_idx').on(table.tagId),
}))

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
  chapterHref: text('chapter_href'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  // Notes are exempt: rereads produce new ideas on the same range over time
  userBookCfiTypeIdx: uniqueIndex('annotation_user_book_cfi_type_idx')
    .on(table.userId, table.bookId, table.cfiRange, table.type)
    .where(sql`${table.type} != 'note'`),
}))

