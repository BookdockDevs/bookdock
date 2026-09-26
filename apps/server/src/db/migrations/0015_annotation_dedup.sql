-- Phase 3 annotation dedup backstop: the service restores soft-deleted rows
-- on duplicate creates (mirroring the legacy partial unique index, notes
-- exempt). Migrated rows already comply; concurrent double-submits hit the
-- constraint instead of forking duplicates.
CREATE UNIQUE INDEX `highlights_user_version_cfi_unique` ON `highlights` (`user_id`, `book_version_id`, `cfi_range`);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_user_version_cfi_unique` ON `bookmarks` (`user_id`, `book_version_id`, `cfi`);
