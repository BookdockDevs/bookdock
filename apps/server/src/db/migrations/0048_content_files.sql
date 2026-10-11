CREATE TABLE `content_upload_drafts` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `draft_id` text NOT NULL,
  `domain` text NOT NULL CHECK (`domain` IN ('idea', 'review')),
  `book_version_id` text NOT NULL,
  `intended_target_id` text,
  `cancelled_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_upload_drafts_unique` ON `content_upload_drafts` (`user_id`, `draft_id`);
--> statement-breakpoint
CREATE TABLE `content_files` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `domain` text NOT NULL CHECK (`domain` IN ('idea', 'review')),
  `kind` text NOT NULL CHECK (`kind` IN ('image', 'attachment')),
  `draft_id` text NOT NULL,
  `book_version_id` text NOT NULL,
  `intended_target_id` text,
  `review_id` text REFERENCES `book_reviews`(`id`) ON DELETE cascade,
  `idea_id` text REFERENCES `ideas`(`id`) ON DELETE cascade,
  `blob_key` text NOT NULL REFERENCES `blobs`(`key`) ON DELETE restrict,
  `name` text NOT NULL,
  `mime_type` text NOT NULL,
  `size` integer NOT NULL CHECK (`size` > 0),
  `ready` integer NOT NULL DEFAULT 0 CHECK (`ready` IN (0, 1)),
  `created_at` integer NOT NULL,
  CHECK (`review_id` IS NULL OR (`domain` = 'review' AND `idea_id` IS NULL)),
  CHECK (`idea_id` IS NULL OR (`domain` = 'idea' AND `review_id` IS NULL AND `kind` = 'image')),
  CHECK (`domain` = 'review' OR `kind` = 'image')
);
--> statement-breakpoint
CREATE INDEX `content_files_draft_idx` ON `content_files` (`user_id`, `draft_id`);
--> statement-breakpoint
CREATE INDEX `content_files_review_idx` ON `content_files` (`review_id`);
--> statement-breakpoint
CREATE INDEX `content_files_idea_idx` ON `content_files` (`idea_id`);
--> statement-breakpoint
CREATE INDEX `content_files_blob_idx` ON `content_files` (`blob_key`);
