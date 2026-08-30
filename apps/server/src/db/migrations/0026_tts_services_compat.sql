CREATE TABLE IF NOT EXISTS `tts_services` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`base_url` text,
	`model` text,
	`default_voice` text,
	`options` text DEFAULT '{}' NOT NULL,
	`encrypted_secrets` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tts_services_user_name_idx` ON `tts_services` (`user_id`,`name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tts_services_user_updated_idx` ON `tts_services` (`user_id`,`updated_at`);
