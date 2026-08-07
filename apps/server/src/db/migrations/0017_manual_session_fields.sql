ALTER TABLE `reading_sessions` ADD `ended_at` integer;
--> statement-breakpoint
ALTER TABLE `reading_sessions` ADD `start_cfi` text;
--> statement-breakpoint
ALTER TABLE `reading_sessions` ADD `end_cfi` text;
--> statement-breakpoint
ALTER TABLE `reading_sessions` ADD `start_fraction` real;
--> statement-breakpoint
ALTER TABLE `reading_sessions` ADD `end_fraction` real;
--> statement-breakpoint
ALTER TABLE `reading_sessions` ADD `start_chapter_index` integer;
--> statement-breakpoint
ALTER TABLE `reading_sessions` ADD `end_chapter_index` integer;
