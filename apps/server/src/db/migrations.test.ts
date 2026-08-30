import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

function statements(file: string): string[] {
  return fs
    .readFileSync(path.join(migrationsDir, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
}

function applyUpTo(sqlite: Database.Database, lastIdx: number) {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const idx = Number(file.slice(0, 4))
    if (idx > lastIdx) break
    for (const stmt of statements(file)) sqlite.exec(stmt)
  }
}

function applyMigration(sqlite: Database.Database, file: string) {
  for (const stmt of statements(file)) sqlite.exec(stmt)
}

describe('migration 0021_single_shelf', () => {
  it('backfills a deterministic single shelf per book and drops book_shelves', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyUpTo(sqlite, 20)

    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO shelves (id, user_id, name, sort_order, created_at) VALUES
        ('s_low', 'u1', 'Low', 1, 10),
        ('s_high_sort', 'u1', 'HighSort', 0, 999),
        ('s_early', 'u1', 'Early', 0, 50),
        ('s_aaa', 'u1', 'Aaa', 0, 50),
        ('s_bbb', 'u1', 'Bbb', 0, 50);
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at) VALUES
        ('b_sort', 'u1', 'B1', 'txt', 'k1', 1, 1, 1),
        ('b_time', 'u1', 'B2', 'txt', 'k2', 1, 1, 1),
        ('b_idtie', 'u1', 'B3', 'txt', 'k3', 1, 1, 1),
        ('b_none', 'u1', 'B4', 'txt', 'k4', 1, 1, 1);
      INSERT INTO book_shelves (book_id, shelf_id) VALUES
        ('b_sort', 's_low'),
        ('b_sort', 's_high_sort'),
        ('b_time', 's_high_sort'),
        ('b_time', 's_early'),
        ('b_idtie', 's_aaa'),
        ('b_idtie', 's_bbb');
    `)

    applyMigration(sqlite, '0021_single_shelf.sql')

    const rows = sqlite.prepare('SELECT id, shelf_id FROM books ORDER BY id').all() as { id: string; shelf_id: string | null }[]
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.shelf_id]))
    // tie-breaks: lowest sortOrder, then lowest createdAt, then lowest id
    expect(byId['b_sort']).toBe('s_high_sort')
    expect(byId['b_time']).toBe('s_early')
    expect(byId['b_idtie']).toBe('s_aaa')
    expect(byId['b_none']).toBeNull()

    const dropped = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_shelves'").all()
    expect(dropped).toHaveLength(0)
  })

  it('sets books.shelf_id to NULL when a shelf is deleted (FK set null)', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyUpTo(sqlite, 21)
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO shelves (id, user_id, name, sort_order, created_at) VALUES ('s1', 'u1', 'S1', 0, 1);
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at, shelf_id)
        VALUES ('b1', 'u1', 'B1', 'txt', 'k1', 1, 1, 1, 's1');
    `)
    sqlite.exec(`DELETE FROM shelves WHERE id = 's1'`)
    const row = sqlite.prepare('SELECT shelf_id FROM books WHERE id = ?').get('b1') as { shelf_id: string | null }
    expect(row.shelf_id).toBeNull()
  })
})

describe('migration 0022_text_transforms', () => {
  function seedUserBookTransform(sqlite: Database.Database) {
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at)
        VALUES ('b1', 'u1', 'B1', 'txt', 'k1', 1, 1, 1);
      INSERT INTO text_transforms (id, user_id, book_id, pattern, created_at, updated_at) VALUES
        ('t_book', 'u1', 'b1', 'x', 1, 1),
        ('t_global', 'u1', NULL, 'y', 1, 1);
    `)
  }

  it('creates text_transforms with global (NULL book_id) rows allowed', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyUpTo(sqlite, 22)
    seedUserBookTransform(sqlite)
    const rows = sqlite.prepare('SELECT id FROM text_transforms ORDER BY id').all()
    expect(rows.map((r) => (r as { id: string }).id)).toEqual(['t_book', 't_global'])
  })

  it('cascades book-scoped transforms on book delete, keeps global ones', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyUpTo(sqlite, 22)
    seedUserBookTransform(sqlite)
    sqlite.exec(`DELETE FROM books WHERE id = 'b1'`)
    const rows = sqlite.prepare('SELECT id FROM text_transforms').all()
    expect(rows.map((r) => (r as { id: string }).id)).toEqual(['t_global'])
  })
})

describe('migration 0023_text_transform_overrides', () => {
  function seedOverrideFixtures(sqlite: Database.Database) {
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at)
        VALUES ('b1', 'u1', 'B1', 'txt', 'k1', 1, 1, 1);
      INSERT INTO text_transforms (id, user_id, pattern, created_at, updated_at)
        VALUES ('t1', 'u1', 'x', 1, 1);
      INSERT INTO text_transform_overrides (id, user_id, book_id, transform_id, enabled, created_at, updated_at)
        VALUES ('o1', 'u1', 'b1', 't1', 0, 1, 1);
    `)
  }

  it('enforces the (book_id, transform_id) unique constraint', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyUpTo(sqlite, 23)
    seedOverrideFixtures(sqlite)
    expect(() => sqlite.exec(`
      INSERT INTO text_transform_overrides (id, user_id, book_id, transform_id, enabled, created_at, updated_at)
        VALUES ('o2', 'u1', 'b1', 't1', 1, 1, 1);
    `)).toThrow()
  })

  it('cascades override rows on transform delete', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyUpTo(sqlite, 23)
    seedOverrideFixtures(sqlite)
    sqlite.exec(`DELETE FROM text_transforms WHERE id = 't1'`)
    expect(sqlite.prepare('SELECT id FROM text_transform_overrides').all()).toHaveLength(0)
  })

  it('cascades override rows on book delete', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyUpTo(sqlite, 23)
    seedOverrideFixtures(sqlite)
    sqlite.exec(`DELETE FROM books WHERE id = 'b1'`)
    expect(sqlite.prepare('SELECT id FROM text_transform_overrides').all()).toHaveLength(0)
    expect(sqlite.prepare('SELECT id FROM text_transforms').all()).toHaveLength(1)
  })
})

describe('migration 0026_tts_services_compat', () => {
  it('creates the current TTS service table when the legacy config table exists', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyUpTo(sqlite, 20)
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      CREATE TABLE tts_configs (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        engine text DEFAULT 'system' NOT NULL,
        updated_at integer NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
      );
      INSERT INTO tts_configs (id, user_id, engine, updated_at) VALUES ('legacy', 'u1', 'system', 1);
    `)

    applyMigration(sqlite, '0026_tts_services_compat.sql')

    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tts_services'").all()).toHaveLength(1)
    expect(sqlite.prepare('SELECT id FROM tts_configs').all()).toEqual([{ id: 'legacy' }])
  })
})
