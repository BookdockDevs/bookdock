CREATE TABLE `fonts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`),
	`scope` text NOT NULL DEFAULT 'user',
	`family` text NOT NULL,
	`file_name` text NOT NULL,
	`format` text NOT NULL,
	`content_hash` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fonts_user_content_hash_idx` ON `fonts` (`user_id`, `content_hash`);
--> statement-breakpoint
CREATE INDEX `fonts_content_hash_idx` ON `fonts` (`content_hash`);
