CREATE TABLE `reading_projection_states` (
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `book_version_id` text NOT NULL,
  `fact_version` integer NOT NULL DEFAULT 0,
  `algorithm_version` integer NOT NULL DEFAULT 1,
  `content_revision_id` text,
  `content_word_count` integer,
  `status` text NOT NULL DEFAULT 'ready',
  `error` text,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`user_id`,`book_version_id`)
);
--> statement-breakpoint
CREATE INDEX `reading_projection_states_user_version_idx` ON `reading_projection_states` (`user_id`,`book_version_id`,`fact_version`);
--> statement-breakpoint
ALTER TABLE `reading_records` ADD COLUMN `fact_version` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `reading_records` ADD COLUMN `word_units` integer;
--> statement-breakpoint
ALTER TABLE `reading_records` ADD COLUMN `word_state` text NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE `reading_records` ADD COLUMN `progress_delta` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `reading_records` ADD COLUMN `coverage` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE INDEX `reading_sessions_user_book_id_idx` ON `reading_sessions` (`user_id`,`book_id`,`id`);
--> statement-breakpoint
ALTER TABLE `reading_sessions` ADD COLUMN `sort_date` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `reading_sessions` SET `sort_date` = `date` WHERE `sort_date` = '';
--> statement-breakpoint
ALTER TABLE `reading_sessions` ADD COLUMN `sort_started_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `reading_sessions` SET `sort_started_at` = coalesce(`started_at`, 0);
--> statement-breakpoint
CREATE INDEX `reading_sessions_user_book_sort_idx` ON `reading_sessions` (`user_id`,`book_id`,`sort_date`,`sort_started_at`,`id`);
--> statement-breakpoint
CREATE TABLE `reading_contributions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `book_version_id` text NOT NULL,
  `session_id` text REFERENCES `reading_sessions`(`id`) ON DELETE cascade,
  `round_id` text REFERENCES `reading_rounds`(`id`) ON DELETE cascade,
  `contribution_key` text NOT NULL,
  `date` text NOT NULL,
  `hour` integer,
  `duration_seconds` integer NOT NULL,
  `word_units` integer,
  `coverage` text NOT NULL DEFAULT '[]'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reading_contributions_user_key_idx` ON `reading_contributions` (`user_id`,`contribution_key`);
--> statement-breakpoint
CREATE INDEX `reading_contributions_session_date_idx` ON `reading_contributions` (`user_id`,`book_version_id`,`session_id`,`date`,`hour`);
--> statement-breakpoint
CREATE INDEX `reading_contributions_book_date_idx` ON `reading_contributions` (`user_id`,`book_version_id`,`date`,`hour`);
--> statement-breakpoint
CREATE TABLE `reading_hourly_stats` (
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `book_version_id` text NOT NULL,
  `date` text NOT NULL,
  `hour` integer NOT NULL,
  `fact_version` integer NOT NULL,
  `duration_seconds` integer NOT NULL,
  `session_count` integer NOT NULL,
  PRIMARY KEY (`user_id`,`book_version_id`,`date`,`hour`)
);
--> statement-breakpoint
CREATE INDEX `reading_hourly_stats_book_hour_idx` ON `reading_hourly_stats` (`user_id`,`book_version_id`,`hour`,`date`);
--> statement-breakpoint
CREATE TABLE `reading_round_stats` (
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `round_id` text NOT NULL REFERENCES `reading_rounds`(`id`) ON DELETE cascade,
  `book_version_id` text NOT NULL,
  `fact_version` integer NOT NULL,
  `total_seconds` integer NOT NULL,
  `session_count` integer NOT NULL,
  `coverage` text NOT NULL DEFAULT '[]',
  `word_count` integer,
  `word_state` text NOT NULL,
  UNIQUE (`user_id`,`round_id`)
);
--> statement-breakpoint
CREATE INDEX `reading_round_stats_book_idx` ON `reading_round_stats` (`user_id`,`book_version_id`,`round_id`);
--> statement-breakpoint
CREATE TABLE `reading_book_stats` (
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `book_version_id` text NOT NULL,
  `fact_version` integer NOT NULL,
  `algorithm_version` integer NOT NULL,
  `content_revision_id` text,
  `content_word_count` integer,
  `total_seconds` integer NOT NULL,
  `session_count` integer NOT NULL,
  `reading_days` integer NOT NULL,
  `total_word_units` integer,
  `known_word_units` integer NOT NULL DEFAULT 0,
  `known_duration_seconds` integer NOT NULL DEFAULT 0,
  `known_contribution_count` integer NOT NULL DEFAULT 0,
  `unknown_contribution_count` integer NOT NULL DEFAULT 0,
  `word_state` text NOT NULL,
  `coverage` text NOT NULL DEFAULT '[]',
  `earliest_date` text,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`user_id`,`book_version_id`)
);
--> statement-breakpoint
CREATE INDEX `reading_book_stats_user_book_idx` ON `reading_book_stats` (`user_id`,`book_version_id`,`fact_version`);
--> statement-breakpoint
CREATE TRIGGER `reading_projection_revision_insert` AFTER INSERT ON `content_revisions`
BEGIN
  UPDATE `reading_projection_states`
  SET `status` = 'failed', `error` = 'content revision changed', `updated_at` = CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE `book_version_id` = NEW.`book_version_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `reading_projection_revision_update` AFTER UPDATE OF `book_version_id`, `revision_no`, `blob_key`, `word_count`, `meta` ON `content_revisions`
BEGIN
  UPDATE `reading_projection_states`
  SET `status` = 'failed', `error` = 'content revision changed', `updated_at` = CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE `book_version_id` = OLD.`book_version_id` OR `book_version_id` = NEW.`book_version_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `reading_projection_revision_delete` AFTER DELETE ON `content_revisions`
BEGIN
  UPDATE `reading_projection_states`
  SET `status` = 'failed', `error` = 'content revision changed', `updated_at` = CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE `book_version_id` = OLD.`book_version_id`;
END;
