DROP INDEX `annotation_user_book_cfi_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `annotation_user_book_cfi_type_idx` ON `annotations` (`user_id`,`book_id`,`cfi_range`,`type`);
