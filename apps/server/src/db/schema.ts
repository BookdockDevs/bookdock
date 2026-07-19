import { sqliteTable, text, integer, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash'),
  role: text('role', { enum: ['owner', 'member', 'guest'] }).notNull().default('owner'),
  createdAt: integer('created_at').notNull(),
})

export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  author: text('author').notNull().default(''),
  format: text('format', { enum: ['epub', 'txt'] }).notNull(),
  filePath: text('file_path').notNull(),
  coverKey: text('cover_key'),
  size: integer('size').notNull(),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
})

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
}))

export const readingProgress = sqliteTable('reading_progress', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  cfi: text('cfi'),
  chapter: text('chapter'),
  percent: integer('percent').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  userBookIdx: uniqueIndex('user_book_idx').on(table.userId, table.bookId),
}))

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  key: text('key').notNull(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
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
}, (table) => ({
  userBookCfiIdx: uniqueIndex('annotation_user_book_cfi_idx').on(table.userId, table.bookId, table.cfiRange),
}))
