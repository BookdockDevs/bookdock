ALTER TABLE `text_replacements` DROP COLUMN `case_sensitive`;
--> statement-breakpoint
ALTER TABLE `text_replacements` ADD COLUMN `apply_to` text NOT NULL DEFAULT 'content';
