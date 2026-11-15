import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Category and tag tables the value model retired.
 *
 * These shapes are gone from `schema.ts` because nothing in the running app may
 * use them any more, but boot-time migrations for older databases still have to
 * read them: those runs predate the cutover, so the tables are still physically
 * present when they happen. Declaring them here keeps the live schema free of
 * retired tables while leaving the historical migrations honest about what they
 * read.
 *
 * Everything in this file is read-only, except in the two migrations that move
 * data out of these shapes (`category-shelf-migration.ts`,
 * `book-classification-migration.ts`), which run before the drop.
 */

export const legacyLibraryCategories = sqliteTable('library_categories', {
  id: text('id').primaryKey(),
  libraryId: text('library_id').notNull(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const legacyLibraryTags = sqliteTable('library_tags', {
  id: text('id').primaryKey(),
  libraryId: text('library_id').notNull(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const legacyLibraryBookTags = sqliteTable('library_book_tags', {
  libraryBookId: text('library_book_id').notNull(),
  tagId: text('tag_id').notNull(),
})

/**
 * `library_books` as the pre-value migrations saw it: the live table plus the
 * retired `category_id` column. Reads and writes land on the same physical rows
 * as `libraryBooks`; only the columns those migrations touch are declared.
 */
export const legacyCategoryAssignedBooks = sqliteTable('library_books', {
  id: text('id').primaryKey(),
  libraryId: text('library_id').notNull(),
  userId: text('user_id').notNull(),
  categoryId: text('category_id'),
  shelfId: text('shelf_id'),
})
