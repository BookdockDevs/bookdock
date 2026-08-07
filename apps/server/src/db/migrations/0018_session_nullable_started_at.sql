-- Retroactive manual entries may record only a date + duration, so started_at
-- becomes nullable (SQLite has no ALTER COLUMN: rebuild the table).
CREATE TABLE `__new_reading_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`date` text NOT NULL,
	`started_at` integer,
	`duration_seconds` integer NOT NULL DEFAULT 0,
	`ended_at` integer,
	`start_cfi` text,
	`end_cfi` text,
	`start_fraction` real,
	`end_fraction` real,
	`start_chapter_index` integer,
	`end_chapter_index` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_reading_sessions`(`id`, `user_id`, `book_id`, `date`, `started_at`, `duration_seconds`, `ended_at`, `start_cfi`, `end_cfi`, `start_fraction`, `end_fraction`, `start_chapter_index`, `end_chapter_index`) SELECT `id`, `user_id`, `book_id`, `date`, `started_at`, `duration_seconds`, `ended_at`, `start_cfi`, `end_cfi`, `start_fraction`, `end_fraction`, `start_chapter_index`, `end_chapter_index` FROM `reading_sessions`;
--> statement-breakpoint
DROP TABLE `reading_sessions`;
--> statement-breakpoint
ALTER TABLE `__new_reading_sessions` RENAME TO `reading_sessions`;
--> statement-breakpoint
CREATE INDEX `reading_sessions_user_date_idx` ON `reading_sessions` (`user_id`,`date`);
