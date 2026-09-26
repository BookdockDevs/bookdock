-- Phase 1 reading entities: User x BookVersion dimension from day one.
-- Structure only; existing annotations/progress/reading_records migrate in
-- Phase 2. revision_id and ideas.shared_library_id are plain text without
-- FKs: anchors and provenance must outlive whatever they point at.
CREATE TABLE `book_states` (
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`book_version_id` text NOT NULL REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	`read_status` text DEFAULT 'reading' NOT NULL,
	`percent` integer DEFAULT 0 NOT NULL,
	`cfi` text,
	`chapter` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`,`book_version_id`)
);
--> statement-breakpoint
CREATE TABLE `highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`book_version_id` text NOT NULL REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade,
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
CREATE INDEX `highlights_user_version_idx` ON `highlights` (`user_id`,`book_version_id`,`deleted_at`);
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`book_version_id` text NOT NULL REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	`revision_id` text,
	`cfi` text,
	`chapter` text,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `bookmarks_user_version_idx` ON `bookmarks` (`user_id`,`book_version_id`,`deleted_at`);
--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`book_version_id` text REFERENCES `book_versions`(`id`) ON UPDATE no action ON DELETE cascade,
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
);
--> statement-breakpoint
CREATE INDEX `ideas_user_version_idx` ON `ideas` (`user_id`,`book_version_id`,`deleted_at`);
--> statement-breakpoint
CREATE INDEX `ideas_shared_idx` ON `ideas` (`shared_library_id`,`visibility`);
