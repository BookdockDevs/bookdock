ALTER TABLE `blobs` ADD COLUMN `storage_tier` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
ALTER TABLE `blobs` ADD COLUMN `last_accessed_at` integer;
--> statement-breakpoint
ALTER TABLE `instance` ADD COLUMN `storage_backend_enabled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `instance` ADD COLUMN `storage_backend_connection_id` text REFERENCES storage_connections(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `instance` ADD COLUMN `storage_backend_base_path` text DEFAULT '/Bookdock/storage' NOT NULL;
--> statement-breakpoint
ALTER TABLE `instance` ADD COLUMN `storage_backend_cache_max_mb` integer DEFAULT 2048 NOT NULL;
--> statement-breakpoint
ALTER TABLE `instance` ADD COLUMN `storage_backend_status` text DEFAULT 'disabled' NOT NULL;
--> statement-breakpoint
ALTER TABLE `instance` ADD COLUMN `storage_backend_last_tested_at` integer;
--> statement-breakpoint
ALTER TABLE `instance` ADD COLUMN `storage_backend_latency_ms` integer;
--> statement-breakpoint
CREATE TABLE `storage_transfer_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `blob_key` text NOT NULL,
  `task_type` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `last_error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `storage_transfer_tasks_status_idx` ON `storage_transfer_tasks` (`status`);
--> statement-breakpoint
CREATE INDEX `storage_transfer_tasks_blob_key_idx` ON `storage_transfer_tasks` (`blob_key`);
