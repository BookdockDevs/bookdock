-- Imported reading history (导入阅读历史): unified-archive extensions. See
-- architecture.md "Imported reading history".
ALTER TABLE reading_archives ADD COLUMN import_source TEXT;
--> statement-breakpoint
ALTER TABLE reading_archives ADD COLUMN import_account_key TEXT;
--> statement-breakpoint
ALTER TABLE reading_archives ADD COLUMN import_book_key TEXT;
--> statement-breakpoint
ALTER TABLE reading_archives ADD COLUMN cover_url TEXT;
--> statement-breakpoint
ALTER TABLE reading_archives ADD COLUMN archive_kind TEXT NOT NULL DEFAULT 'book';
--> statement-breakpoint
ALTER TABLE reading_archives ADD COLUMN meta TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX reading_archives_import_identity_unique ON reading_archives (user_id, import_source, import_account_key, import_book_key) WHERE import_source IS NOT NULL;
--> statement-breakpoint
-- highlights.cfi_range becomes nullable: imported highlights without a
-- derivable CFI express unknown position as NULL (SQLite treats NULLs as
-- distinct, keeping the unique index meaningful). SQLite cannot drop NOT
-- NULL in place, so the table is rebuilt.
CREATE TABLE highlights_new (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_version_id TEXT NOT NULL,
  revision_id TEXT,
  cfi_range TEXT,
  cfi_anchor TEXT,
  color TEXT NOT NULL DEFAULT 'yellow',
  style TEXT NOT NULL DEFAULT 'highlight',
  text TEXT NOT NULL DEFAULT '',
  chapter TEXT,
  chapter_href TEXT,
  relocation TEXT NOT NULL DEFAULT 'ok',
  import_key TEXT,
  import_hash TEXT,
  import_locator TEXT,
  import_chapter_index INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
--> statement-breakpoint
INSERT INTO highlights_new (id, user_id, book_version_id, revision_id, cfi_range, cfi_anchor, color, style, text, chapter, chapter_href, relocation, import_key, import_hash, created_at, updated_at, deleted_at)
  SELECT id, user_id, book_version_id, revision_id, cfi_range, cfi_anchor, color, style, text, chapter, chapter_href, relocation, NULL, NULL, created_at, updated_at, deleted_at FROM highlights;
--> statement-breakpoint
DROP TABLE highlights;
--> statement-breakpoint
ALTER TABLE highlights_new RENAME TO highlights;
--> statement-breakpoint
CREATE INDEX highlights_user_version_idx ON highlights (user_id, book_version_id, deleted_at);
--> statement-breakpoint
CREATE UNIQUE INDEX highlights_user_version_cfi_unique ON highlights (user_id, book_version_id, cfi_range);
--> statement-breakpoint
CREATE UNIQUE INDEX highlights_import_key_unique ON highlights (user_id, import_key) WHERE import_key IS NOT NULL;
--> statement-breakpoint
ALTER TABLE bookmarks ADD COLUMN import_key TEXT;
--> statement-breakpoint
ALTER TABLE bookmarks ADD COLUMN import_hash TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX bookmarks_import_key_unique ON bookmarks (user_id, import_key) WHERE import_key IS NOT NULL;
--> statement-breakpoint
ALTER TABLE ideas ADD COLUMN import_key TEXT;
--> statement-breakpoint
ALTER TABLE ideas ADD COLUMN import_hash TEXT;
--> statement-breakpoint
ALTER TABLE ideas ADD COLUMN import_locator TEXT;
--> statement-breakpoint
ALTER TABLE ideas ADD COLUMN import_chapter_index INTEGER;
--> statement-breakpoint
CREATE UNIQUE INDEX ideas_import_key_unique ON ideas (user_id, import_key) WHERE import_key IS NOT NULL;
--> statement-breakpoint
-- Duration facts point at a *book version*, which may be an import archive
-- (target_book_version_id still an archive id) or a real mounted book. There is
-- deliberately no foreign key to reading_archives: mounting moves the facts to
-- a version that table may not carry, and deleting the archive row must not
-- cascade the duration away (see docs/local/dev/reading-data-import.md 0.11).
CREATE TABLE reading_duration_facts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_version_id TEXT,
  granularity TEXT NOT NULL CHECK (granularity IN ('book_total', 'book_day', 'account_total', 'account_day')),
  date TEXT,
  source TEXT NOT NULL,
  source_namespace TEXT NOT NULL,
  source_record_key TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  aggregation_role TEXT NOT NULL CHECK (aggregation_role IN ('additive', 'reference')),
  overlap_group TEXT,
  observed_at INTEGER NOT NULL,
  CHECK (granularity NOT IN ('book_total', 'book_day') OR book_version_id IS NOT NULL),
  CHECK ((granularity IN ('book_day', 'account_day') AND date IS NOT NULL) OR (granularity IN ('book_total', 'account_total') AND date IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX reading_duration_facts_source_record_unique ON reading_duration_facts (user_id, source, source_namespace, source_record_key);
--> statement-breakpoint
CREATE INDEX reading_duration_facts_user_date_idx ON reading_duration_facts (user_id, date);
--> statement-breakpoint
CREATE INDEX reading_duration_facts_user_book_idx ON reading_duration_facts (user_id, book_version_id);
--> statement-breakpoint
-- Source identity -> target resolution lives here and only here (0.11 #2).
-- Before mounting, target_book_version_id is the import archive; after
-- mounting the archive row is gone and it is the real book version. Keeping the
-- mapping outside reading_archives is what stops a re-import from rebuilding a
-- freshly mounted archive and silently undoing the mount.
CREATE TABLE reading_import_bindings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  account_key TEXT NOT NULL,
  book_key TEXT NOT NULL,
  target_book_version_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('archive', 'mounted')),
  auto_sync INTEGER NOT NULL DEFAULT 0,
  last_synced_at INTEGER,
  mounted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX reading_import_bindings_identity_unique ON reading_import_bindings (user_id, source, account_key, book_key);
--> statement-breakpoint
CREATE INDEX reading_import_bindings_target_idx ON reading_import_bindings (user_id, target_book_version_id);
--> statement-breakpoint
-- book_reviews gains import_key and relaxes its anchor CHECK: an imported
-- whole-book review is anchored by readBookVersionId alone (no library work
-- exists behind an imported archive), so the table is rebuilt.
CREATE TABLE book_reviews_new (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  private_library_book_id TEXT,
  source_library_id TEXT,
  source_library_book_id TEXT,
  rating_halves INTEGER CHECK (rating_halves IS NULL OR (rating_halves >= 1 AND rating_halves <= 10)),
  body TEXT,
  body_format TEXT NOT NULL DEFAULT 'markdown',
  visibility TEXT NOT NULL DEFAULT 'private',
  read_listing_id TEXT,
  read_book_version_id TEXT,
  read_revision_id TEXT,
  import_key TEXT,
  import_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  edited_at INTEGER, title TEXT,
  CHECK (
    (private_library_book_id IS NOT NULL AND source_library_id IS NULL AND source_library_book_id IS NULL)
    OR (private_library_book_id IS NULL AND source_library_id IS NOT NULL AND source_library_book_id IS NOT NULL)
    OR (import_key IS NOT NULL AND private_library_book_id IS NULL AND source_library_id IS NULL AND source_library_book_id IS NULL)
  ),
  CHECK (rating_halves IS NOT NULL OR (body IS NOT NULL AND body <> ''))
);
--> statement-breakpoint
INSERT INTO book_reviews_new (id, user_id, private_library_book_id, source_library_id, source_library_book_id, rating_halves, body, body_format, visibility, read_listing_id, read_book_version_id, read_revision_id, import_key, created_at, updated_at, edited_at, title)
  SELECT id, user_id, private_library_book_id, source_library_id, source_library_book_id, rating_halves, body, body_format, visibility, read_listing_id, read_book_version_id, read_revision_id, NULL, created_at, updated_at, edited_at, title FROM book_reviews;
--> statement-breakpoint
-- Child rows referencing book_reviews would be cascaded away by the DROP
-- (foreign keys are on during upgrades); back them up and restore them.
CREATE TEMP TABLE import_backup_review_comments AS SELECT "id", "review_id", "user_id", "parent_id", "reply_to_id", "body", "created_at", "edited_at", "deleted_at" FROM "book_review_comments";
--> statement-breakpoint
CREATE TEMP TABLE import_backup_review_likes AS SELECT "review_id", "user_id", "created_at" FROM "book_review_likes";
--> statement-breakpoint
CREATE TEMP TABLE import_backup_review_comment_likes AS SELECT "comment_id", "user_id", "created_at" FROM "book_review_comment_likes";
--> statement-breakpoint
CREATE TEMP TABLE import_backup_review_files AS SELECT "id", "user_id", "domain", "kind", "draft_id", "book_version_id", "intended_target_id", "review_id", "idea_id", "blob_key", "name", "mime_type", "size", "ready", "sort_order", "created_at" FROM "content_files" WHERE "review_id" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "content_files" WHERE "review_id" IS NOT NULL;
--> statement-breakpoint
DROP TABLE book_reviews;
--> statement-breakpoint
ALTER TABLE book_reviews_new RENAME TO book_reviews;
--> statement-breakpoint
INSERT INTO "book_review_comments" ("id", "review_id", "user_id", "parent_id", "reply_to_id", "body", "created_at", "edited_at", "deleted_at") SELECT "id", "review_id", "user_id", "parent_id", "reply_to_id", "body", "created_at", "edited_at", "deleted_at" FROM import_backup_review_comments;
--> statement-breakpoint
INSERT INTO "book_review_likes" ("review_id", "user_id", "created_at") SELECT "review_id", "user_id", "created_at" FROM import_backup_review_likes;
--> statement-breakpoint
INSERT INTO "book_review_comment_likes" ("comment_id", "user_id", "created_at") SELECT "comment_id", "user_id", "created_at" FROM import_backup_review_comment_likes;
--> statement-breakpoint
INSERT INTO "content_files" ("id", "user_id", "domain", "kind", "draft_id", "book_version_id", "intended_target_id", "review_id", "idea_id", "blob_key", "name", "mime_type", "size", "ready", "sort_order", "created_at") SELECT "id", "user_id", "domain", "kind", "draft_id", "book_version_id", "intended_target_id", "review_id", "idea_id", "blob_key", "name", "mime_type", "size", "ready", "sort_order", "created_at" FROM import_backup_review_files;
--> statement-breakpoint
DROP TABLE import_backup_review_comments;
--> statement-breakpoint
DROP TABLE import_backup_review_likes;
--> statement-breakpoint
DROP TABLE import_backup_review_comment_likes;
--> statement-breakpoint
DROP TABLE import_backup_review_files;
--> statement-breakpoint
CREATE INDEX book_reviews_user_idx ON book_reviews (user_id, updated_at);
--> statement-breakpoint
CREATE INDEX book_reviews_source_idx ON book_reviews (source_library_id, source_library_book_id, visibility);
--> statement-breakpoint
CREATE UNIQUE INDEX book_reviews_source_user_unique ON book_reviews(source_library_id, source_library_book_id, user_id) WHERE source_library_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX book_reviews_private_unique ON book_reviews(private_library_book_id) WHERE private_library_book_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX book_reviews_import_key_unique ON book_reviews (user_id, import_key) WHERE import_key IS NOT NULL;
