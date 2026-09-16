ALTER TABLE `text_transform_overrides` RENAME TO `text_replacement_overrides`;
--> statement-breakpoint
ALTER TABLE `text_transforms` RENAME TO `text_replacements`;
--> statement-breakpoint
ALTER TABLE `text_replacement_overrides` RENAME COLUMN `transform_id` TO `replacement_id`;
--> statement-breakpoint
DROP INDEX `text_transform_overrides_book_transform_unique`;
--> statement-breakpoint
DROP INDEX `text_transform_overrides_user_book_idx`;
--> statement-breakpoint
DROP INDEX `text_transforms_user_book_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `text_replacement_overrides_book_replacement_unique` ON `text_replacement_overrides` (`book_id`,`replacement_id`);
--> statement-breakpoint
CREATE INDEX `text_replacement_overrides_user_book_idx` ON `text_replacement_overrides` (`user_id`,`book_id`);
--> statement-breakpoint
CREATE INDEX `text_replacements_user_book_idx` ON `text_replacements` (`user_id`,`book_id`);
