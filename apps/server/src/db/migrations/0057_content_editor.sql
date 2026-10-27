CREATE TABLE `content_revision_maps` (
  `id` text PRIMARY KEY NOT NULL,
  `book_version_id` text NOT NULL REFERENCES `book_versions`(`id`) ON DELETE cascade,
  `source_revision_id` text NOT NULL,
  `target_revision_id` text NOT NULL REFERENCES `content_revisions`(`id`) ON DELETE cascade,
  `segments` text NOT NULL DEFAULT '[]',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_revision_maps_source_target_unique` ON `content_revision_maps` (`source_revision_id`,`target_revision_id`);
--> statement-breakpoint
CREATE INDEX `content_revision_maps_target_idx` ON `content_revision_maps` (`book_version_id`,`target_revision_id`);
--> statement-breakpoint
CREATE INDEX `content_revision_maps_source_idx` ON `content_revision_maps` (`book_version_id`,`source_revision_id`);
--> statement-breakpoint
ALTER TABLE `book_states` ADD COLUMN `progress_revision_id` text;
--> statement-breakpoint
ALTER TABLE bookmarks ADD COLUMN relocation TEXT NOT NULL DEFAULT 'ok' CHECK (relocation IN ('ok', 'unresolved'));
--> statement-breakpoint
ALTER TABLE ideas ADD COLUMN relocation TEXT NOT NULL DEFAULT 'ok' CHECK (relocation IN ('ok', 'unresolved'));
--> statement-breakpoint
ALTER TABLE text_replacements ADD COLUMN relocation TEXT NOT NULL DEFAULT 'ok' CHECK (relocation IN ('ok', 'unresolved'));
--> statement-breakpoint
ALTER TABLE `book_states` ADD COLUMN `coverage_revision_id` text;
--> statement-breakpoint

UPDATE `book_states`
SET `coverage_revision_id` = COALESCE(
  `progress_revision_id`,
  json_extract(`progress_data`, '$.coverageRevisionId'),
  json_extract(`progress_data`, '$.progressRevisionId')
);
--> statement-breakpoint
ALTER TABLE content_revision_maps
ADD COLUMN source_sections TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE content_revision_maps
ADD COLUMN target_sections TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE content_revision_maps
ADD COLUMN structural_ranges TEXT NOT NULL DEFAULT '[]';
