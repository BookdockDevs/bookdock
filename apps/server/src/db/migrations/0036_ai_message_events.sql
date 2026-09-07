CREATE TABLE `ai_message_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`phase` text,
	`name` text,
	`chapter_index` integer,
	`result_chars` integer,
	`citation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `ai_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `ai_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_message_events_message_sequence_unique` ON `ai_message_events` (`message_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `ai_message_events_user_thread_created_idx` ON `ai_message_events` (`user_id`,`thread_id`,`created_at`);
