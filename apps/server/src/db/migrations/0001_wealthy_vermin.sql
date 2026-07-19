CREATE TABLE `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`cfi_range` text NOT NULL,
	`cfi_anchor` text,
	`type` text NOT NULL,
	`color` text DEFAULT 'yellow' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`note` text,
	`chapter` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `annotation_user_book_cfi_idx` ON `annotations` (`user_id`,`book_id`,`cfi_range`);