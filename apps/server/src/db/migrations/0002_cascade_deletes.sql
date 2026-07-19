PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `book_shelves_new` (
	`book_id` text NOT NULL,
	`shelf_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shelf_id`) REFERENCES `shelves`(`id`) ON UPDATE no action ON DELETE cascade,
	PRIMARY KEY(`book_id`, `shelf_id`)
);
--> statement-breakpoint
INSERT INTO `book_shelves_new` SELECT * FROM `book_shelves`;
--> statement-breakpoint
DROP TABLE `book_shelves`;
--> statement-breakpoint
ALTER TABLE `book_shelves_new` RENAME TO `book_shelves`;
--> statement-breakpoint
CREATE TABLE `book_tags_new` (
	`book_id` text NOT NULL,
	`tag_id` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	PRIMARY KEY(`book_id`, `tag_id`)
);
--> statement-breakpoint
INSERT INTO `book_tags_new` SELECT * FROM `book_tags`;
--> statement-breakpoint
DROP TABLE `book_tags`;
--> statement-breakpoint
ALTER TABLE `book_tags_new` RENAME TO `book_tags`;
--> statement-breakpoint
CREATE TABLE `reading_progress_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`cfi` text,
	`chapter` text,
	`percent` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `reading_progress_new` SELECT * FROM `reading_progress`;
--> statement-breakpoint
DROP TABLE `reading_progress`;
--> statement-breakpoint
ALTER TABLE `reading_progress_new` RENAME TO `reading_progress`;
--> statement-breakpoint
CREATE UNIQUE INDEX `user_book_idx` ON `reading_progress` (`user_id`,`book_id`);
--> statement-breakpoint
CREATE TABLE `annotations_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`cfi_range` text NOT NULL,
	`cfi_anchor` text,
	`type` text NOT NULL,
	`color` text DEFAULT 'yellow' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`note` text,
	`chapter` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `annotations_new` SELECT * FROM `annotations`;
--> statement-breakpoint
DROP TABLE `annotations`;
--> statement-breakpoint
ALTER TABLE `annotations_new` RENAME TO `annotations`;
--> statement-breakpoint
CREATE UNIQUE INDEX `annotation_user_book_cfi_idx` ON `annotations` (`user_id`,`book_id`,`cfi_range`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
