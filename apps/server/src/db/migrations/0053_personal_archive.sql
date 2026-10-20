-- Personal annotations retain provenance after source deletion; account ownership still cascades.
ALTER TABLE reading_archives ADD COLUMN format TEXT;
--> statement-breakpoint
ALTER TABLE reading_archives ADD COLUMN cover_key TEXT;
--> statement-breakpoint
CREATE TEMP TABLE archive_backup_highlights AS SELECT "id", "user_id", "book_version_id", "revision_id", "cfi_range", "cfi_anchor", "color", "style", "text", "chapter", "chapter_href", "relocation", "created_at", "updated_at", "deleted_at" FROM "highlights";
--> statement-breakpoint
CREATE TEMP TABLE archive_backup_bookmarks AS SELECT "id", "user_id", "book_version_id", "revision_id", "cfi", "chapter", "title", "created_at", "updated_at", "deleted_at", "chapter_href", "context_text" FROM "bookmarks";
--> statement-breakpoint
CREATE TEMP TABLE archive_backup_ideas AS SELECT "id", "user_id", "book_version_id", "cfi_range", "text", "note", "visibility", "shared_library_id", "chapter", "chapter_href", "created_at", "updated_at", "deleted_at", "color", "style", "cfi_anchor", "source_library_book_version_id", "revision_id", "edited_at" FROM "ideas";
--> statement-breakpoint
CREATE TEMP TABLE archive_backup_book_reviews AS SELECT "id", "user_id", "private_library_book_id", "source_library_id", "source_library_book_id", "rating_halves", "body", "body_format", "visibility", "read_listing_id", "read_book_version_id", "read_revision_id", "created_at", "updated_at", "edited_at", "title" FROM "book_reviews";
--> statement-breakpoint
CREATE TEMP TABLE archive_backup_idea_comments AS SELECT "id", "idea_id", "user_id", "parent_id", "reply_to_id", "body", "created_at", "edited_at", "deleted_at" FROM "idea_comments";
--> statement-breakpoint
CREATE TEMP TABLE archive_backup_idea_likes AS SELECT "idea_id", "user_id", "created_at" FROM "idea_likes";
--> statement-breakpoint
CREATE TEMP TABLE archive_backup_idea_comment_likes AS SELECT "comment_id", "user_id", "created_at" FROM "idea_comment_likes";
--> statement-breakpoint
CREATE TEMP TABLE archive_backup_book_review_comments AS SELECT "id", "review_id", "user_id", "parent_id", "reply_to_id", "body", "created_at", "edited_at", "deleted_at" FROM "book_review_comments";
--> statement-breakpoint
CREATE TEMP TABLE archive_backup_book_review_likes AS SELECT "review_id", "user_id", "created_at" FROM "book_review_likes";
--> statement-breakpoint
CREATE TEMP TABLE archive_backup_book_review_comment_likes AS SELECT "comment_id", "user_id", "created_at" FROM "book_review_comment_likes";
--> statement-breakpoint
CREATE TEMP TABLE archive_backup_content_files AS SELECT "id", "user_id", "domain", "kind", "draft_id", "book_version_id", "intended_target_id", "review_id", "idea_id", "blob_key", "name", "mime_type", "size", "ready", "created_at", "sort_order" FROM content_files;
--> statement-breakpoint
DROP TABLE "highlights";
--> statement-breakpoint
CREATE TABLE `highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`book_version_id` text NOT NULL,
	`revision_id` text,
	`cfi_range` text NOT NULL,
	`cfi_anchor` text,
	`color` text DEFAULT 'yellow' NOT NULL,
	`style` text DEFAULT 'highlight' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`chapter` text,
	`chapter_href` text,
	`relocation` text DEFAULT 'ok' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO "highlights" ("id", "user_id", "book_version_id", "revision_id", "cfi_range", "cfi_anchor", "color", "style", "text", "chapter", "chapter_href", "relocation", "created_at", "updated_at", "deleted_at") SELECT "id", "user_id", "book_version_id", "revision_id", "cfi_range", "cfi_anchor", "color", "style", "text", "chapter", "chapter_href", "relocation", "created_at", "updated_at", "deleted_at" FROM archive_backup_highlights;
--> statement-breakpoint
CREATE INDEX `highlights_user_version_idx` ON `highlights` (`user_id`,`book_version_id`,`deleted_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `highlights_user_version_cfi_unique` ON `highlights` (`user_id`, `book_version_id`, `cfi_range`);
--> statement-breakpoint
DROP TABLE "bookmarks";
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`book_version_id` text NOT NULL,
	`revision_id` text,
	`cfi` text,
	`chapter` text,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
, `chapter_href` text, `context_text` text);
--> statement-breakpoint
INSERT INTO "bookmarks" ("id", "user_id", "book_version_id", "revision_id", "cfi", "chapter", "title", "created_at", "updated_at", "deleted_at", "chapter_href", "context_text") SELECT "id", "user_id", "book_version_id", "revision_id", "cfi", "chapter", "title", "created_at", "updated_at", "deleted_at", "chapter_href", "context_text" FROM archive_backup_bookmarks;
--> statement-breakpoint
CREATE INDEX `bookmarks_user_version_idx` ON `bookmarks` (`user_id`,`book_version_id`,`deleted_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_user_version_cfi_unique` ON `bookmarks` (`user_id`, `book_version_id`, `cfi`);
--> statement-breakpoint
DROP TABLE "ideas";
--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`book_version_id` text,
	`cfi_range` text,
	`text` text DEFAULT '' NOT NULL,
	`note` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`shared_library_id` text,
	`chapter` text,
	`chapter_href` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
, `color` text NOT NULL DEFAULT 'yellow', `style` text NOT NULL DEFAULT 'underline', `cfi_anchor` text, source_library_book_version_id TEXT, revision_id TEXT, edited_at INTEGER);
--> statement-breakpoint
INSERT INTO "ideas" ("id", "user_id", "book_version_id", "cfi_range", "text", "note", "visibility", "shared_library_id", "chapter", "chapter_href", "created_at", "updated_at", "deleted_at", "color", "style", "cfi_anchor", "source_library_book_version_id", "revision_id", "edited_at") SELECT "id", "user_id", "book_version_id", "cfi_range", "text", "note", "visibility", "shared_library_id", "chapter", "chapter_href", "created_at", "updated_at", "deleted_at", "color", "style", "cfi_anchor", "source_library_book_version_id", "revision_id", "edited_at" FROM archive_backup_ideas;
--> statement-breakpoint
CREATE INDEX `ideas_user_version_idx` ON `ideas` (`user_id`,`book_version_id`,`deleted_at`);
--> statement-breakpoint
CREATE INDEX `ideas_shared_idx` ON `ideas` (`shared_library_id`,`visibility`);
--> statement-breakpoint
DROP TABLE "book_reviews";
--> statement-breakpoint
CREATE TABLE book_reviews (
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
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  edited_at INTEGER, title TEXT,
  CHECK (
    (private_library_book_id IS NOT NULL AND source_library_id IS NULL AND source_library_book_id IS NULL)
    OR (private_library_book_id IS NULL AND source_library_id IS NOT NULL AND source_library_book_id IS NOT NULL)
  ),
  CHECK (rating_halves IS NOT NULL OR (body IS NOT NULL AND body <> ''))
);
--> statement-breakpoint
INSERT INTO "book_reviews" ("id", "user_id", "private_library_book_id", "source_library_id", "source_library_book_id", "rating_halves", "body", "body_format", "visibility", "read_listing_id", "read_book_version_id", "read_revision_id", "created_at", "updated_at", "edited_at", "title") SELECT "id", "user_id", "private_library_book_id", "source_library_id", "source_library_book_id", "rating_halves", "body", "body_format", "visibility", "read_listing_id", "read_book_version_id", "read_revision_id", "created_at", "updated_at", "edited_at", "title" FROM archive_backup_book_reviews;
--> statement-breakpoint
CREATE UNIQUE INDEX book_reviews_source_user_unique ON book_reviews(source_library_id, source_library_book_id, user_id) WHERE source_library_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX book_reviews_private_unique ON book_reviews(private_library_book_id) WHERE private_library_book_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX book_reviews_source_idx ON book_reviews(source_library_id, source_library_book_id, visibility);
--> statement-breakpoint
CREATE INDEX book_reviews_user_idx ON book_reviews(user_id, updated_at);
--> statement-breakpoint
INSERT INTO "idea_comments" ("id", "idea_id", "user_id", "parent_id", "reply_to_id", "body", "created_at", "edited_at", "deleted_at") SELECT "id", "idea_id", "user_id", "parent_id", "reply_to_id", "body", "created_at", "edited_at", "deleted_at" FROM archive_backup_idea_comments;
--> statement-breakpoint
INSERT INTO "idea_likes" ("idea_id", "user_id", "created_at") SELECT "idea_id", "user_id", "created_at" FROM archive_backup_idea_likes;
--> statement-breakpoint
INSERT INTO "idea_comment_likes" ("comment_id", "user_id", "created_at") SELECT "comment_id", "user_id", "created_at" FROM archive_backup_idea_comment_likes;
--> statement-breakpoint
INSERT INTO "book_review_comments" ("id", "review_id", "user_id", "parent_id", "reply_to_id", "body", "created_at", "edited_at", "deleted_at") SELECT "id", "review_id", "user_id", "parent_id", "reply_to_id", "body", "created_at", "edited_at", "deleted_at" FROM archive_backup_book_review_comments;
--> statement-breakpoint
INSERT INTO "book_review_likes" ("review_id", "user_id", "created_at") SELECT "review_id", "user_id", "created_at" FROM archive_backup_book_review_likes;
--> statement-breakpoint
INSERT INTO "book_review_comment_likes" ("comment_id", "user_id", "created_at") SELECT "comment_id", "user_id", "created_at" FROM archive_backup_book_review_comment_likes;
--> statement-breakpoint
INSERT INTO content_files ("id", "user_id", "domain", "kind", "draft_id", "book_version_id", "intended_target_id", "review_id", "idea_id", "blob_key", "name", "mime_type", "size", "ready", "created_at", "sort_order") SELECT "id", "user_id", "domain", "kind", "draft_id", "book_version_id", "intended_target_id", "review_id", "idea_id", "blob_key", "name", "mime_type", "size", "ready", "created_at", "sort_order" FROM archive_backup_content_files;
--> statement-breakpoint
DROP TABLE archive_backup_content_files;
--> statement-breakpoint
DROP TABLE archive_backup_highlights;
--> statement-breakpoint
DROP TABLE archive_backup_bookmarks;
--> statement-breakpoint
DROP TABLE archive_backup_ideas;
--> statement-breakpoint
DROP TABLE archive_backup_book_reviews;
--> statement-breakpoint
DROP TABLE archive_backup_idea_comments;
--> statement-breakpoint
DROP TABLE archive_backup_idea_likes;
--> statement-breakpoint
DROP TABLE archive_backup_idea_comment_likes;
--> statement-breakpoint
DROP TABLE archive_backup_book_review_comments;
--> statement-breakpoint
DROP TABLE archive_backup_book_review_likes;
--> statement-breakpoint
DROP TABLE archive_backup_book_review_comment_likes;
--> statement-breakpoint
UPDATE book_reviews SET read_book_version_id = (SELECT book_version_id FROM library_book_versions WHERE library_book_id = book_reviews.private_library_book_id ORDER BY created_at, id LIMIT 1)
WHERE private_library_book_id IS NOT NULL AND read_book_version_id IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO reading_archives(user_id, book_version_id, title, author, format, cover_key, created_at, updated_at)
SELECT own.user_id, own.book_version_id,
  COALESCE((SELECT COALESCE(v.title, b.title) FROM library_book_versions v JOIN library_books b ON b.id = v.library_book_id
    JOIN libraries l ON l.id = b.library_id WHERE l.type = 'private' AND b.user_id = own.user_id AND v.book_version_id = own.book_version_id LIMIT 1), 'Unavailable book'),
  COALESCE((SELECT COALESCE(v.author, b.author) FROM library_book_versions v JOIN library_books b ON b.id = v.library_book_id
    JOIN libraries l ON l.id = b.library_id WHERE l.type = 'private' AND b.user_id = own.user_id AND v.book_version_id = own.book_version_id LIMIT 1), ''),
  (SELECT format FROM book_versions WHERE id = own.book_version_id),
  (SELECT COALESCE(v.cover_key, b.cover_key) FROM library_book_versions v JOIN library_books b ON b.id = v.library_book_id
    JOIN libraries l ON l.id = b.library_id WHERE l.type = 'private' AND b.user_id = own.user_id AND v.book_version_id = own.book_version_id LIMIT 1),
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM (
  SELECT user_id, book_version_id FROM highlights WHERE deleted_at IS NULL
  UNION SELECT user_id, book_version_id FROM bookmarks WHERE deleted_at IS NULL
  UNION SELECT user_id, book_version_id FROM ideas WHERE deleted_at IS NULL AND book_version_id IS NOT NULL
  UNION SELECT user_id, read_book_version_id FROM book_reviews WHERE read_book_version_id IS NOT NULL
) own;
--> statement-breakpoint
UPDATE reading_archives SET format = (SELECT format FROM book_versions WHERE id = reading_archives.book_version_id),
  cover_key = (SELECT COALESCE(v.cover_key, b.cover_key) FROM library_book_versions v JOIN library_books b ON b.id = v.library_book_id
    JOIN libraries l ON l.id = b.library_id WHERE l.type = 'private' AND b.user_id = reading_archives.user_id AND v.book_version_id = reading_archives.book_version_id LIMIT 1);
