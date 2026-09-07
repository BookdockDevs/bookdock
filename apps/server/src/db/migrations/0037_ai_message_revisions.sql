ALTER TABLE `ai_messages` ADD `revision_group_id` text;
--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `revision` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `is_selected` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE INDEX `ai_messages_revision_group_idx` ON `ai_messages` (`user_id`,`thread_id`,`revision_group_id`,`revision`);
