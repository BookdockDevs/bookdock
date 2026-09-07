CREATE TABLE `ai_book_indexes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`source_version` text NOT NULL,
	`status` text NOT NULL,
	`embedding_status` text DEFAULT 'unavailable' NOT NULL,
	`embedding_provider` text,
	`embedding_model` text,
	`embedding_dim` integer,
	`progress` integer DEFAULT 0 NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_book_indexes_user_book_unique` ON `ai_book_indexes` (`user_id`,`book_id`);--> statement-breakpoint
CREATE INDEX `ai_book_indexes_user_status_updated_idx` ON `ai_book_indexes` (`user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_chunk_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`index_id` text NOT NULL,
	`chunk_id` text NOT NULL,
	`book_id` text NOT NULL,
	`model` text NOT NULL,
	`dimension` integer NOT NULL,
	`vector` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`index_id`) REFERENCES `ai_book_indexes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `ai_chunks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_chunk_embeddings_index_chunk_unique` ON `ai_chunk_embeddings` (`index_id`,`chunk_id`);--> statement-breakpoint
CREATE INDEX `ai_chunk_embeddings_user_book_idx` ON `ai_chunk_embeddings` (`user_id`,`book_id`,`index_id`);--> statement-breakpoint
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
CREATE INDEX `ai_chunks_user_book_chapter_idx` ON `ai_chunks` (`user_id`,`book_id`,`chapter_index`,`start_offset`);--> statement-breakpoint
CREATE INDEX `ai_chunks_index_id_idx` ON `ai_chunks` (`index_id`);--> statement-breakpoint
CREATE TABLE `ai_generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`request_id` text NOT NULL,
	`target_message_id` text,
	`state` text NOT NULL,
	`state_revision` integer DEFAULT 0 NOT NULL,
	`checkpoint_seq` integer DEFAULT 0 NOT NULL,
	`checkpoint_text` text DEFAULT '' NOT NULL,
	`checkpoint_events` text,
	`checkpoint_usage` text,
	`diagnostics` text,
	`error_code` text,
	`reason` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`terminal_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `ai_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_message_id`) REFERENCES `ai_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_generation_runs_request_unique` ON `ai_generation_runs` (`request_id`);--> statement-breakpoint
CREATE INDEX `ai_generation_runs_user_thread_updated_idx` ON `ai_generation_runs` (`user_id`,`thread_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_generation_runs_active_user_unique` ON `ai_generation_runs` (`user_id`) WHERE "ai_generation_runs"."state" IN ('preparing', 'requesting', 'streaming', 'waiting_tool');--> statement-breakpoint
CREATE TABLE `ai_message_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`phase` text,
	`name` text,
	`chapter_index` integer,
	`result_chars` integer,
	`citation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `ai_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `ai_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_message_events_message_sequence_unique` ON `ai_message_events` (`message_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `ai_message_events_user_thread_created_idx` ON `ai_message_events` (`user_id`,`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`context` text,
	`retry` text,
	`citations` text,
	`revision_group_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`is_selected` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`aborted` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `ai_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_messages_user_thread_created_idx` ON `ai_messages` (`user_id`,`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_messages_revision_group_idx` ON `ai_messages` (`user_id`,`thread_id`,`revision_group_id`,`revision`);--> statement-breakpoint
CREATE TABLE `ai_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`title` text NOT NULL,
	`settings` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_threads_user_book_updated_idx` ON `ai_threads` (`user_id`,`book_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`cfi_range` text NOT NULL,
	`cfi_anchor` text,
	`type` text NOT NULL,
	`color` text DEFAULT 'yellow' NOT NULL,
	`style` text DEFAULT 'underline' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`note` text,
	`chapter` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `annotation_user_book_cfi_type_idx` ON `annotations` (`user_id`,`book_id`,`cfi_range`,`type`) WHERE "annotations"."type" != 'note';--> statement-breakpoint
CREATE TABLE `book_tags` (
	`book_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`book_id`, `tag_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `book_tags_tag_idx` ON `book_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`format` text NOT NULL,
	`file_path` text NOT NULL,
	`cover_key` text,
	`content_hash` text,
	`size` integer NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`read_status` text DEFAULT 'reading' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`pinned_at` integer,
	`last_read_at` integer,
	`deleted_at` integer,
	`shelf_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shelf_id`) REFERENCES `shelves`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `books_user_deleted_idx` ON `books` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `books_content_hash_idx` ON `books` (`content_hash`);--> statement-breakpoint
CREATE INDEX `books_shelf_idx` ON `books` (`shelf_id`);--> statement-breakpoint
CREATE TABLE `fonts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text DEFAULT 'user' NOT NULL,
	`family` text NOT NULL,
	`file_name` text NOT NULL,
	`format` text NOT NULL,
	`content_hash` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fonts_user_content_hash_idx` ON `fonts` (`user_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `fonts_content_hash_idx` ON `fonts` (`content_hash`);--> statement-breakpoint
CREATE TABLE `instance_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reading_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`date` text NOT NULL,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reading_records_user_book_date_idx` ON `reading_records` (`user_id`,`book_id`,`date`);--> statement-breakpoint
CREATE INDEX `reading_records_user_date_idx` ON `reading_records` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `reading_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`date` text NOT NULL,
	`started_at` integer,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`ended_at` integer,
	`start_cfi` text,
	`end_cfi` text,
	`start_fraction` real,
	`end_fraction` real,
	`start_chapter_index` integer,
	`end_chapter_index` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reading_sessions_user_date_idx` ON `reading_sessions` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_user_key_idx` ON `settings` (`user_id`,`key`);--> statement-breakpoint
CREATE TABLE `shelves` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `text_transform_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`transform_id` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transform_id`) REFERENCES `text_transforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `text_transform_overrides_book_transform_unique` ON `text_transform_overrides` (`book_id`,`transform_id`);--> statement-breakpoint
CREATE INDEX `text_transform_overrides_user_book_idx` ON `text_transform_overrides` (`user_id`,`book_id`);--> statement-breakpoint
CREATE TABLE `text_transforms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text,
	`match_type` text DEFAULT 'pattern' NOT NULL,
	`pattern` text,
	`replacement` text,
	`is_regex` integer DEFAULT 0 NOT NULL,
	`case_sensitive` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`name` text,
	`group_name` text,
	`spine_href` text,
	`text_offset` integer,
	`original_text` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `text_transforms_user_book_idx` ON `text_transforms` (`user_id`,`book_id`);--> statement-breakpoint
CREATE TABLE `toc_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`patterns` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `toc_rules_user_idx` ON `toc_rules` (`user_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `tts_services` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`base_url` text,
	`model` text,
	`default_voice` text,
	`options` text DEFAULT '{}' NOT NULL,
	`encrypted_secrets` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tts_services_user_name_idx` ON `tts_services` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `tts_services_user_updated_idx` ON `tts_services` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text,
	`role` text DEFAULT 'owner' NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`avatar_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
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
