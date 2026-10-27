import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runDatabaseMigrations } from './client'
import * as schema from './schema'
import { recordActivityEvent } from '../lib/activity-events'

vi.mock('../modules/progress/progress-migration', () => ({ importProgressFiles: async () => undefined }))

let sqlite: Database.Database
afterEach(() => sqlite?.close())

async function migrate(db: ReturnType<typeof drizzle<typeof schema>>) {
  await runDatabaseMigrations(db, { beforeRetarget: () => undefined })
}

function removeReadingProjectionSchema(sqlite: Database.Database) {
  sqlite.exec(`
    DROP TRIGGER IF EXISTS reading_projection_revision_delete;
    DROP TRIGGER IF EXISTS reading_projection_revision_update;
    DROP TRIGGER IF EXISTS reading_projection_revision_insert;
    DROP INDEX IF EXISTS reading_book_stats_user_book_idx;
    DROP TABLE IF EXISTS reading_book_stats;
    DROP INDEX IF EXISTS reading_round_stats_book_idx;
    DROP TABLE IF EXISTS reading_round_stats;
    DROP INDEX IF EXISTS reading_hourly_stats_book_hour_idx;
    DROP TABLE IF EXISTS reading_hourly_stats;
    DROP INDEX IF EXISTS reading_contributions_book_date_idx;
    DROP INDEX IF EXISTS reading_contributions_session_date_idx;
    DROP INDEX IF EXISTS reading_contributions_user_key_idx;
    DROP TABLE IF EXISTS reading_contributions;
    DROP INDEX IF EXISTS reading_projection_states_user_version_idx;
    DROP TABLE IF EXISTS reading_projection_states;
    DROP INDEX IF EXISTS reading_sessions_user_book_sort_idx;
    DROP INDEX IF EXISTS reading_sessions_user_book_id_idx;
    ALTER TABLE reading_sessions DROP COLUMN sort_started_at;
    ALTER TABLE reading_sessions DROP COLUMN sort_date;
    ALTER TABLE reading_records DROP COLUMN progress_delta;
    ALTER TABLE reading_records DROP COLUMN coverage;
    ALTER TABLE reading_records DROP COLUMN word_state;
    ALTER TABLE reading_records DROP COLUMN word_units;
    ALTER TABLE reading_records DROP COLUMN fact_version;
  `)
}

describe('activity migration', () => {
  it('creates indexed event storage on an empty database', async () => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    await migrate(drizzle(sqlite, { schema }))
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'activity_events'").get()).toEqual({ name: 'activity_events' })
    expect(sqlite.prepare('PRAGMA foreign_key_list(activity_events)').all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'libraries', from: 'library_id', on_delete: 'CASCADE' }),
    ]))
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('backfills only known shared-public idea and review timestamps and safely upgrades an existing library', async () => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    await migrate(db)
    removeReadingProjectionSchema(sqlite)
    sqlite.exec(`
      DROP TABLE activity_events;
      DROP TABLE content_revision_maps;
      ALTER TABLE book_states DROP COLUMN progress_revision_id;
      ALTER TABLE book_states DROP COLUMN coverage_revision_id;
      ALTER TABLE bookmarks DROP COLUMN relocation;
      ALTER TABLE ideas DROP COLUMN relocation;
      ALTER TABLE text_replacements DROP COLUMN relocation;
      DELETE FROM __drizzle_migrations WHERE created_at >= 1793300000000;
    `)
    sqlite.exec(`
      INSERT INTO users(id,username,created_at) VALUES ('author','Author',1),('other','Other',1);
      INSERT INTO libraries(id,user_id,type,name,visibility,created_at,updated_at) VALUES ('source','author','shared','Source','public',1,1);
      INSERT INTO libraries(id,user_id,type,name,created_at,updated_at) VALUES ('private','other','private','Private',1,1);
      INSERT INTO book_versions(id,format,size,created_at,updated_at) VALUES ('v1','epub',10,1,1),('v2','epub',10,1,1);
      INSERT INTO library_books(id,library_id,user_id,title,created_at,updated_at) VALUES ('work','source','author','Work',1,1);
      INSERT INTO library_books(id,library_id,user_id,title,created_at,updated_at) VALUES ('private-work','private','other','Private work',1,1);
      INSERT INTO library_book_versions(id,library_id,library_book_id,book_version_id,kind,status,created_at,updated_at) VALUES ('listing','source','work','v1','shared','published',1,1);
      INSERT INTO ideas(id,user_id,book_version_id,text,note,visibility,shared_library_id,source_library_book_version_id,created_at,updated_at)
        VALUES ('public-idea','author','v1','Idea','Note','shared','source','listing',123,130),
          ('private-idea','author','v1','Private','Private','private',NULL,NULL,124,131);
      INSERT INTO book_reviews(id,user_id,private_library_book_id,source_library_id,source_library_book_id,read_book_version_id,body,visibility,created_at,updated_at)
        VALUES ('public-review','other',NULL,'source','work','v1','Review','shared',234,240),
          ('private-review','other','private-work',NULL,NULL,'v2','Private','private',235,241);
    `)
    await migrate(db)
    const events = sqlite.prepare('SELECT event_type, target_id, actor_user_id, version_id, occurred_at FROM activity_events ORDER BY target_id').all()
    expect(events).toEqual([
      { event_type: 'idea.published', target_id: 'public-idea', actor_user_id: 'author', version_id: 'v1', occurred_at: 123 },
      { event_type: 'review.published', target_id: 'public-review', actor_user_id: 'other', version_id: 'v1', occurred_at: 234 },
    ])
    db.transaction((tx) => recordActivityEvent(tx, {
      idempotencyKey: 'idea.published:public-idea', eventType: 'idea.published', audience: 'library', libraryId: 'source',
      actorUserId: 'author', targetKind: 'idea', targetId: 'public-idea', workId: 'work', versionId: 'v1', occurredAt: 123,
      snapshotWorkTitle: 'This is ordinary content and must not be retained',
    }))
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM activity_events').get()).toEqual({ count: 2 })
    expect(sqlite.prepare('SELECT snapshot_work_title FROM activity_events WHERE target_id = ?').get('public-idea'))
      .toEqual({ snapshot_work_title: null })
    db.delete(schema.libraries).where(eq(schema.libraries.id, 'source')).run()
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM activity_events').get()).toEqual({ count: 0 })
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
