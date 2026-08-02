CREATE TABLE `instance_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `disabled` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `users` ADD `updated_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_user_key_idx` ON `settings` (`user_id`, `key`);
--> statement-breakpoint
DROP TABLE `reading_progress`;
