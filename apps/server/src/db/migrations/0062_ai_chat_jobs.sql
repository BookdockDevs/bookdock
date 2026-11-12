CREATE TABLE `ai_chat_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `kind` text NOT NULL,
  `scope_key` text NOT NULL,
  `client_request_id` text NOT NULL,
  `thread_id` text,
  `state` text NOT NULL,
  `snapshot` text NOT NULL,
  `acknowledged_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_chat_jobs_user_scope_idx` ON `ai_chat_jobs` (`user_id`, `kind`, `scope_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_chat_jobs_user_request_unique` ON `ai_chat_jobs` (`user_id`, `client_request_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_chat_jobs_active_user_unique` ON `ai_chat_jobs` (`user_id`) WHERE `state` = 'running';
