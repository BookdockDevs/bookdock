CREATE TABLE `ai_book_indexes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`source_version` text NOT NULL,
	`status` text NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_book_indexes_user_book_unique` ON `ai_book_indexes` (`user_id`,`book_id`);
--> statement-breakpoint
CREATE INDEX `ai_book_indexes_user_status_updated_idx` ON `ai_book_indexes` (`user_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `ai_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`index_id` text NOT NULL,
	`book_id` text NOT NULL,
	`chapter_index` integer NOT NULL,
	`chapter_id` text NOT NULL,
	`chapter_title` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`index_id`) REFERENCES `ai_book_indexes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_chunks_user_book_chapter_idx` ON `ai_chunks` (`user_id`,`book_id`,`chapter_index`,`start_offset`);
--> statement-breakpoint
CREATE INDEX `ai_chunks_index_id_idx` ON `ai_chunks` (`index_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `ai_chunks_fts` USING fts5(
	chunk_id UNINDEXED,
	user_id UNINDEXED,
	book_id UNINDEXED,
	chapter_index UNINDEXED,
	chapter_title UNINDEXED,
	text,
	tokenize = 'trigram'
);
--> statement-breakpoint
CREATE TRIGGER `ai_chunks_fts_insert` AFTER INSERT ON `ai_chunks` BEGIN
	INSERT INTO `ai_chunks_fts` (`chunk_id`, `user_id`, `book_id`, `chapter_index`, `chapter_title`, `text`)
	VALUES (new.`id`, new.`user_id`, new.`book_id`, new.`chapter_index`, new.`chapter_title`, new.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `ai_chunks_fts_delete` AFTER DELETE ON `ai_chunks` BEGIN
	DELETE FROM `ai_chunks_fts` WHERE `chunk_id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `ai_chunks_fts_update` AFTER UPDATE ON `ai_chunks` BEGIN
	DELETE FROM `ai_chunks_fts` WHERE `chunk_id` = old.`id`;
	INSERT INTO `ai_chunks_fts` (`chunk_id`, `user_id`, `book_id`, `chapter_index`, `chapter_title`, `text`)
	VALUES (new.`id`, new.`user_id`, new.`book_id`, new.`chapter_index`, new.`chapter_title`, new.`text`);
END;
