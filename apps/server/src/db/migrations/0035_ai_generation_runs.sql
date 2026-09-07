CREATE TABLE `ai_generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`request_id` text NOT NULL,
	`target_message_id` text,
	`state` text NOT NULL,
	`state_revision` integer DEFAULT 0 NOT NULL,
	`checkpoint_seq` integer DEFAULT 0 NOT NULL,
	`checkpoint_text` text DEFAULT '' NOT NULL,
	`checkpoint_events` text,
	`checkpoint_usage` text,
	`error_code` text,
	`reason` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`terminal_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `ai_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_message_id`) REFERENCES `ai_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_generation_runs_request_unique` ON `ai_generation_runs` (`request_id`);
--> statement-breakpoint
CREATE INDEX `ai_generation_runs_user_thread_updated_idx` ON `ai_generation_runs` (`user_id`,`thread_id`,`updated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_generation_runs_active_user_unique` ON `ai_generation_runs` (`user_id`) WHERE `state` IN ('preparing', 'requesting', 'streaming', 'waiting_tool');
