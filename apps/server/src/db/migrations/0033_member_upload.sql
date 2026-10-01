ALTER TABLE `libraries` ADD `allow_member_upload` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `library_book_versions` ADD `user_id` text;
