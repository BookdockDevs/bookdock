CREATE TABLE `reading_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`book_id` text NOT NULL REFERENCES `books`(`id`) ON DELETE cascade,
	`date` text NOT NULL,
	`duration_seconds` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reading_records_user_book_date_idx` ON `reading_records` (`user_id`, `book_id`, `date`);
--> statement-breakpoint
CREATE INDEX `reading_records_user_date_idx` ON `reading_records` (`user_id`, `date`);
