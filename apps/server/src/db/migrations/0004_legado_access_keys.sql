CREATE TABLE `legado_access_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`token_hash` text NOT NULL,
	`encrypted_token` text,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legado_access_keys_user_unique` ON `legado_access_keys` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `legado_access_keys_token_hash_unique` ON `legado_access_keys` (`token_hash`);
