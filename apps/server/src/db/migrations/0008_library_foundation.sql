-- Phase 1 library foundation: new structure only, no data migration.
-- `user_id` on libraries/library_books/library_categories/library_tags is the
-- owner/tenant key (wire name: ownerUserId). Source ids on
-- library_book_versions are plain text: provenance must survive the deletion
-- of whatever they point at, which no FK cascade/SET NULL can express.
CREATE TABLE `libraries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`visibility` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `libraries_user_type_idx` ON `libraries` (`user_id`,`type`);
--> statement-breakpoint
CREATE TABLE `library_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_memberships_library_user_unique` ON `library_memberships` (`library_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `library_memberships_user_idx` ON `library_memberships` (`user_id`);
--> statement-breakpoint
CREATE TABLE `library_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	`name` text NOT NULL,
	`parent_id` text REFERENCES `library_categories`(`id`) ON UPDATE no action ON DELETE set null,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `library_categories_library_idx` ON `library_categories` (`library_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX `library_categories_parent_idx` ON `library_categories` (`parent_id`);
--> statement-breakpoint
CREATE TABLE `library_books` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	`category_id` text REFERENCES `library_categories`(`id`) ON UPDATE no action ON DELETE set null,
	`title` text NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `library_books_library_idx` ON `library_books` (`library_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `library_books_category_idx` ON `library_books` (`category_id`);
--> statement-breakpoint
CREATE TABLE `book_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`format` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`book_version_id` text NOT NULL REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	`revision_no` integer NOT NULL,
	`blob_key` text NOT NULL,
	`size` integer NOT NULL,
	`word_count` integer,
	`chapter_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_revisions_version_revision_unique` ON `content_revisions` (`book_version_id`,`revision_no`);
--> statement-breakpoint
CREATE INDEX `content_revisions_blob_idx` ON `content_revisions` (`blob_key`);
--> statement-breakpoint
CREATE TABLE `library_book_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	`library_book_id` text NOT NULL REFERENCES `library_books`(`id`) ON UPDATE no action ON DELETE cascade,
	`book_version_id` text NOT NULL REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE no action,
	`kind` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`title` text,
	`author` text,
	`description` text,
	`cover_key` text,
	`source_library_id` text,
	`source_library_book_version_id` text,
	`pinned_revision_id` text REFERENCES `content_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `library_book_versions_book_idx` ON `library_book_versions` (`library_book_id`);
--> statement-breakpoint
CREATE INDEX `library_book_versions_version_idx` ON `library_book_versions` (`book_version_id`);
--> statement-breakpoint
CREATE INDEX `library_book_versions_library_version_idx` ON `library_book_versions` (`library_id`,`book_version_id`);
--> statement-breakpoint
CREATE TABLE `blobs` (
	`key` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_tags_library_name_unique` ON `library_tags` (`library_id`,`name`);
--> statement-breakpoint
CREATE INDEX `library_tags_library_idx` ON `library_tags` (`library_id`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `library_book_tags` (
	`library_book_id` text NOT NULL REFERENCES `library_books`(`id`) ON UPDATE no action ON DELETE cascade,
	`tag_id` text NOT NULL REFERENCES `library_tags`(`id`) ON UPDATE no action ON DELETE cascade,
	PRIMARY KEY(`library_book_id`,`tag_id`)
);
--> statement-breakpoint
CREATE INDEX `library_book_tags_tag_idx` ON `library_book_tags` (`tag_id`);
--> statement-breakpoint
CREATE TABLE `instance` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	`allow_registration` integer DEFAULT false NOT NULL,
	`allow_guest_access` integer DEFAULT false NOT NULL,
	`upload_max_bytes` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`token_hash` text NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_user_expiry_idx` ON `sessions` (`user_id`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `library_migration_log` (
	`id` text PRIMARY KEY NOT NULL,
	`batch` text NOT NULL,
	`status` text NOT NULL,
	`details` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
-- Nullable + UNIQUE: SQLite forbids ADD COLUMN with an inline UNIQUE
-- constraint, so the column and the index ship separately. The unique index
-- ignores NULLs, so Phase 2 backfill cannot collide with not-yet-migrated rows.
ALTER TABLE `users` ADD `username_normalized` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_normalized_unique` ON `users` (`username_normalized`);
--> statement-breakpoint
ALTER TABLE `users` ADD `bio` text DEFAULT '' NOT NULL;
