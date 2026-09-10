ALTER TABLE `tags` ADD `sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `toc_rules` ADD `seed_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `toc_rules_user_seed_key_unique` ON `toc_rules` (`user_id`,`seed_key`);
