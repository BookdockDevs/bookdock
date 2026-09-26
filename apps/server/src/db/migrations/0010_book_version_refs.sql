-- Phase 2 reference backfill (2.8): every book-bound row gains a nullable
-- book_version_id pointing at the new model. Backfill itself happens in the
-- Phase 2 migration service (not here): versions only exist after books
-- migrate, so SQL-side backfill would write ids that nothing references yet.
-- Old book_id columns and constraints stay untouched until Phase 12.
ALTER TABLE `reading_records` ADD `book_version_id` text REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `reading_records_book_version_idx` ON `reading_records` (`book_version_id`);
--> statement-breakpoint
ALTER TABLE `reading_sessions` ADD `book_version_id` text REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `reading_sessions_book_version_idx` ON `reading_sessions` (`book_version_id`);
--> statement-breakpoint
ALTER TABLE `ai_threads` ADD `book_version_id` text REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `ai_threads_book_version_idx` ON `ai_threads` (`book_version_id`);
--> statement-breakpoint
ALTER TABLE `ai_book_indexes` ADD `book_version_id` text REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `ai_book_indexes_book_version_idx` ON `ai_book_indexes` (`book_version_id`);
--> statement-breakpoint
ALTER TABLE `ai_chunks` ADD `book_version_id` text REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `ai_chunks_book_version_idx` ON `ai_chunks` (`book_version_id`);
--> statement-breakpoint
ALTER TABLE `ai_chunk_embeddings` ADD `book_version_id` text REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `ai_chunk_embeddings_book_version_idx` ON `ai_chunk_embeddings` (`book_version_id`);
--> statement-breakpoint
ALTER TABLE `text_replacements` ADD `book_version_id` text REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `text_replacements_book_version_idx` ON `text_replacements` (`book_version_id`);
--> statement-breakpoint
ALTER TABLE `text_replacement_overrides` ADD `book_version_id` text REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `text_replacement_overrides_book_version_idx` ON `text_replacement_overrides` (`book_version_id`);
--> statement-breakpoint
-- Last-read time carried over from books.last_read_at (2.6); position
-- updates keep bumping updated_at, reading alone bumps last_read_at.
ALTER TABLE `book_states` ADD `last_read_at` integer;
