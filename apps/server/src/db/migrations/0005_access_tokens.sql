CREATE TABLE `access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`name` text NOT NULL,
	`permissions` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_last4` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_tokens_token_hash_unique` ON `access_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `access_tokens_user_created_idx` ON `access_tokens` (`user_id`, `created_at`);
