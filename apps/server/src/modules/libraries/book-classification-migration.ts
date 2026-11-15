import { sql } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { createId } from '../../lib/id'

export const BOOK_CLASSIFICATION_MIGRATION_BATCH = 'book-classification-values-v1'

type Db = ReturnType<typeof getDb>

interface LegacyCategory {
  id: string
  libraryId: string
  name: string
  parentId: string | null
  sortOrder: number
  pinned: number
  hidden: number
  createdAt: number
  updatedAt: number
}

interface LegacyTag {
  id: string
  libraryId: string
  name: string
  sortOrder: number
  pinned: number
  hidden: number
  createdAt: number
  updatedAt: number
}

function tableNames(reader: Pick<Db, 'all'>): Set<string> {
  return new Set((reader.all(sql`SELECT name FROM sqlite_master WHERE type = 'table'`) as Array<{ name: string }>).map((row) => row.name))
}

function columnNames(reader: Pick<Db, 'all'>, table: string): Set<string> {
  return new Set((reader.all(sql.raw(`PRAGMA table_info("${table}")`)) as Array<{ name: string }>).map((row) => row.name))
}

function valueStateId(): string {
  return createId('mvs')
}

function ensureClassificationValueTriggers(db: Db) {
  const now = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"
  const addState = (kind: 'category' | 'tag', value: string, libraryId: string) => `
    INSERT INTO library_metadata_value_state
      (id, library_id, kind, value, sort_order, pinned, hidden, created_at, updated_at)
    VALUES (
      'mvs_' || lower(hex(randomblob(16))), ${libraryId}, '${kind}', ${value},
      COALESCE((SELECT MAX(sort_order) + 1 FROM library_metadata_value_state WHERE library_id = ${libraryId} AND kind = '${kind}'), 0),
      0, 0, ${now}, ${now}
    )
    ON CONFLICT(library_id, kind, value) DO UPDATE SET updated_at = excluded.updated_at;
  `
  const touchState = (kind: 'category' | 'tag', value: string, libraryId: string) => `
    UPDATE library_metadata_value_state SET updated_at = ${now}
    WHERE library_id = ${libraryId} AND kind = '${kind}' AND value = ${value};
  `
  const categoryValue = (prefix: 'OLD' | 'NEW') => `CASE WHEN ${prefix}.category_leaf IS NULL
    THEN json_array(${prefix}.category_root) ELSE json_array(${prefix}.category_root, ${prefix}.category_leaf) END`
  const categoryParentValue = (prefix: 'OLD' | 'NEW') => `json_array(${prefix}.category_root)`
  const statements = [
    `CREATE TRIGGER library_books_classification_insert AFTER INSERT ON library_books
      WHEN NEW.category_root IS NOT NULL BEGIN ${addState('category', categoryValue('NEW'), 'NEW.library_id')} END`,
    `CREATE TRIGGER library_books_classification_parent_insert AFTER INSERT ON library_books
      WHEN NEW.category_root IS NOT NULL AND NEW.category_leaf IS NOT NULL BEGIN
        ${addState('category', categoryParentValue('NEW'), 'NEW.library_id')}
      END`,
    `CREATE TRIGGER library_books_classification_update_old AFTER UPDATE OF category_root, category_leaf ON library_books
      WHEN OLD.category_root IS NOT NULL AND (OLD.category_root IS NOT NEW.category_root OR OLD.category_leaf IS NOT NEW.category_leaf) BEGIN
        ${touchState('category', categoryValue('OLD'), 'OLD.library_id')}
      END`,
    `CREATE TRIGGER library_books_classification_update_parent_old AFTER UPDATE OF category_root, category_leaf ON library_books
      WHEN OLD.category_leaf IS NOT NULL AND (OLD.category_root IS NOT NEW.category_root OR OLD.category_leaf IS NOT NEW.category_leaf) BEGIN
        ${touchState('category', categoryParentValue('OLD'), 'OLD.library_id')}
      END`,
    `CREATE TRIGGER library_books_classification_update_new AFTER UPDATE OF category_root, category_leaf ON library_books
      WHEN NEW.category_root IS NOT NULL AND (OLD.category_root IS NOT NEW.category_root OR OLD.category_leaf IS NOT NEW.category_leaf) BEGIN
        ${addState('category', categoryValue('NEW'), 'NEW.library_id')}
      END`,
    `CREATE TRIGGER library_books_classification_update_parent_new AFTER UPDATE OF category_root, category_leaf ON library_books
      WHEN NEW.category_leaf IS NOT NULL AND (OLD.category_root IS NOT NEW.category_root OR OLD.category_leaf IS NOT NEW.category_leaf) BEGIN
        ${addState('category', categoryParentValue('NEW'), 'NEW.library_id')}
      END`,
    `CREATE TRIGGER library_book_tag_values_membership_insert AFTER INSERT ON library_book_tag_values BEGIN
      ${addState('tag', 'NEW.name', '(SELECT library_id FROM library_books WHERE id = NEW.library_book_id)')}
    END`,
    `CREATE TRIGGER library_book_tag_values_membership_delete AFTER DELETE ON library_book_tag_values
      WHEN (SELECT library_id FROM library_books WHERE id = OLD.library_book_id) IS NOT NULL BEGIN
      ${touchState('tag', 'OLD.name', '(SELECT library_id FROM library_books WHERE id = OLD.library_book_id)')}
    END`,
    `CREATE TRIGGER library_book_tag_values_membership_rename AFTER UPDATE OF name ON library_book_tag_values
      WHEN OLD.name IS NOT NEW.name BEGIN
        ${touchState('tag', 'OLD.name', '(SELECT library_id FROM library_books WHERE id = OLD.library_book_id)')}
        ${addState('tag', 'NEW.name', '(SELECT library_id FROM library_books WHERE id = NEW.library_book_id)')}
      END`,
  ]
  for (const name of [
    'library_books_classification_insert',
    'library_books_classification_parent_insert',
    'library_books_classification_update_old',
    'library_books_classification_update_parent_old',
    'library_books_classification_update_new',
    'library_books_classification_update_parent_new',
    'library_book_tag_values_membership_insert',
    'library_book_tag_values_membership_delete',
    'library_book_tag_values_membership_rename',
  ]) db.run(sql.raw(`DROP TRIGGER IF EXISTS ${name}`))
  for (const statement of statements) db.run(sql.raw(statement))
}

interface CategoryValueRow {
  key: string
  libraryId: string
  sortOrder: number
  pinned: number
  hidden: number
  createdAt: number
  updatedAt: number
}

/**
 * Copy the retired category/tag *entities* onto the books that carried them,
 * then drop the entity tables.
 *
 * Categories and tags are values now, so this is the one release that has to
 * read the old rows: each category becomes the name path on every book pointing
 * at it, each tag relation becomes a tag value on that book, and the sidebar
 * state (hidden, pinned, manual order) moves to `library_metadata_value_state`
 * keyed by the value itself. Everything happens in one transaction, and the
 * completion marker is written last, so a crash leaves the old shape intact and
 * the next boot simply redoes it.
 *
 * Two things refuse instead of guessing, because both would lose user intent
 * silently: a book pointing at another library's category or tag, and two
 * distinct categories that resolve to the same name path with different sidebar
 * state. Either one throws and blocks serving — a boot that cannot preserve the
 * old preferences is better than one that quietly drops them.
 */
export function migrateBookClassificationValues(db: Db = getDb()) {
  const marker = db.get(sql`SELECT id FROM library_migration_log WHERE batch = ${BOOK_CLASSIFICATION_MIGRATION_BATCH} AND status = 'completed'`)
  if (marker) {
    ensureClassificationValueTriggers(db)
    return { skipped: true, categories: 0, tags: 0, dropped: false }
  }

  let categories = 0
  let tags = 0

  db.transaction((tx) => {
    const now = Date.now()
    // Read the shape inside the transaction: the drop below is what makes a
    // retry see a database without these tables.
    const tables = tableNames(tx)
    const hasCategories = tables.has('library_categories')
    const hasTags = tables.has('library_tags')
    const hasRelations = tables.has('library_book_tags')
    const hasCategoryColumn = columnNames(tx, 'library_books').has('category_id')

    if (hasCategories && hasCategoryColumn) {
      const rows = tx.all(sql`SELECT id, library_id AS libraryId, name, parent_id AS parentId, sort_order AS sortOrder, pinned, hidden, created_at AS createdAt, updated_at AS updatedAt FROM library_categories`) as LegacyCategory[]
      const byId = new Map(rows.map((row) => [row.id, row]))
      const stateByKey = new Map<string, CategoryValueRow>()

      for (const row of rows) {
        const parent = row.parentId ? byId.get(row.parentId) : undefined
        if (row.parentId && (!parent || parent.libraryId !== row.libraryId || parent.parentId)) {
          throw new Error(`Category ${row.id} has invalid ancestry; refusing to flatten it into a name path`)
        }
        const path = parent ? [parent.name, row.name] : [row.name]
        const key = `${row.libraryId}:${JSON.stringify(path)}`
        tx.run(sql`UPDATE library_books SET category_root = ${path[0]!}, category_leaf = ${path[1] ?? null} WHERE category_id = ${row.id}`)

        const existing = stateByKey.get(key)
        if (existing) {
          if (existing.hidden !== row.hidden || existing.pinned !== row.pinned || existing.sortOrder !== row.sortOrder) {
            throw new Error(`Categories in library ${row.libraryId} collapse to the same value "${path.join(' / ')}" with different sidebar state; resolve them before upgrading`)
          }
          continue
        }
        stateByKey.set(key, {
          key: JSON.stringify(path),
          libraryId: row.libraryId,
          sortOrder: row.sortOrder,
          pinned: row.pinned,
          hidden: row.hidden,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        categories += 1
      }

      for (const state of stateByKey.values()) {
        tx.run(sql`INSERT OR IGNORE INTO library_metadata_value_state (id, library_id, kind, value, sort_order, pinned, hidden, created_at, updated_at)
          VALUES (${valueStateId()}, ${state.libraryId}, 'category', ${state.key}, ${state.sortOrder}, ${state.pinned}, ${state.hidden}, ${state.createdAt}, ${state.updatedAt})`)
      }

      // Every book pointing at a category has to belong to that category's
      // library. A cross-library reference would otherwise file a private book
      // under a shared library's category, so it blocks the upgrade instead.
      const foreign = tx.all(sql`SELECT library_books.id AS id FROM library_books
        INNER JOIN library_categories ON library_categories.id = library_books.category_id
        WHERE library_categories.library_id <> library_books.library_id LIMIT 5`) as Array<{ id: string }>
      if (foreign.length > 0) {
        throw new Error(`Books reference a category from another library (${foreign.map((row) => row.id).join(', ')}); resolve them before upgrading`)
      }
    }

    if (hasTags && hasRelations) {
      const tagRows = tx.all(sql`SELECT id, library_id AS libraryId, name, sort_order AS sortOrder, pinned, hidden, created_at AS createdAt, updated_at AS updatedAt FROM library_tags`) as LegacyTag[]
      const foreign = tx.all(sql`SELECT library_book_tags.library_book_id AS id FROM library_book_tags
        INNER JOIN library_books ON library_books.id = library_book_tags.library_book_id
        INNER JOIN library_tags ON library_tags.id = library_book_tags.tag_id
        WHERE library_tags.library_id <> library_books.library_id LIMIT 5`) as Array<{ id: string }>
      if (foreign.length > 0) {
        throw new Error(`Books reference a tag from another library (${foreign.map((row) => row.id).join(', ')}); resolve them before upgrading`)
      }

      for (const row of tagRows) {
        const links = tx.all(sql`SELECT library_book_id AS libraryBookId FROM library_book_tags WHERE tag_id = ${row.id}`) as Array<{ libraryBookId: string }>
        for (const [sortOrder, link] of links.entries()) {
          tx.run(sql`INSERT OR IGNORE INTO library_book_tag_values (id, library_book_id, name, sort_order)
            VALUES (${createId('btv')}, ${link.libraryBookId}, ${row.name}, ${sortOrder})`)
        }
        tx.run(sql`INSERT OR IGNORE INTO library_metadata_value_state (id, library_id, kind, value, sort_order, pinned, hidden, created_at, updated_at)
          VALUES (${valueStateId()}, ${row.libraryId}, 'tag', ${row.name}, ${row.sortOrder}, ${row.pinned}, ${row.hidden}, ${row.createdAt}, ${row.updatedAt})`)
        tags += 1
      }
    }

    // The cutover: the new columns and tables are the only authority from here
    // on, so the retired shapes go in the same transaction that filled them.
    if (hasRelations) tx.run(sql`DROP TABLE IF EXISTS library_book_tags`)
    if (hasTags) tx.run(sql`DROP TABLE IF EXISTS library_tags`)
    if (hasCategories) tx.run(sql`DROP TABLE IF EXISTS library_categories`)
    if (hasCategoryColumn) {
      tx.run(sql`DROP INDEX IF EXISTS library_books_category_idx`)
      tx.run(sql`ALTER TABLE library_books DROP COLUMN category_id`)
    }

    tx.run(sql`INSERT INTO library_migration_log (id, batch, status, started_at, finished_at, details)
      VALUES (${createId('lmig')}, ${BOOK_CLASSIFICATION_MIGRATION_BATCH}, 'completed', ${now}, ${now}, ${JSON.stringify({ categories, tags })})`)
  })

  ensureClassificationValueTriggers(db)

  return { skipped: false, categories, tags, dropped: true }
}
