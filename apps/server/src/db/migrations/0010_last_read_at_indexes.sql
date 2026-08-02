ALTER TABLE `books` ADD `last_read_at` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `books_user_deleted_idx` ON `books` (`user_id`, `deleted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `books_content_hash_idx` ON `books` (`content_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `book_shelves_shelf_idx` ON `book_shelves` (`shelf_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `book_tags_tag_idx` ON `book_tags` (`tag_id`);
