CREATE TABLE `text_transform_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`transform_id` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transform_id`) REFERENCES `text_transforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `text_transform_overrides_book_transform_unique` ON `text_transform_overrides` (`book_id`, `transform_id`);
--> statement-breakpoint
CREATE INDEX `text_transform_overrides_user_book_idx` ON `text_transform_overrides` (`user_id`, `book_id`);
