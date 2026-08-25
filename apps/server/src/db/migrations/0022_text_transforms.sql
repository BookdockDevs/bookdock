CREATE TABLE `text_transforms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text,
	`match_type` text NOT NULL DEFAULT 'pattern',
	`pattern` text,
	`replacement` text,
	`is_regex` integer NOT NULL DEFAULT 0,
	`case_sensitive` integer NOT NULL DEFAULT 0,
	`enabled` integer NOT NULL DEFAULT 1,
	`name` text,
	`group_name` text,
	`spine_href` text,
	`text_offset` integer,
	`original_text` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `text_transforms_user_book_idx` ON `text_transforms` (`user_id`, `book_id`);
