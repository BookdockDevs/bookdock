ALTER TABLE `ai_book_indexes` ADD `embedding_status` text DEFAULT 'unavailable' NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_book_indexes` ADD `embedding_model` text;
--> statement-breakpoint
ALTER TABLE `ai_book_indexes` ADD `embedding_dim` integer;
--> statement-breakpoint
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
CREATE UNIQUE INDEX `ai_chunk_embeddings_index_chunk_unique` ON `ai_chunk_embeddings` (`index_id`,`chunk_id`);
--> statement-breakpoint
CREATE INDEX `ai_chunk_embeddings_user_book_idx` ON `ai_chunk_embeddings` (`user_id`,`book_id`,`index_id`);
