CREATE TABLE `shelves` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shelves_library_sort_idx` ON `shelves` (`library_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `shelves_library_name_unique` ON `shelves` (`library_id`,`name`);
--> statement-breakpoint
ALTER TABLE `library_books` ADD `shelf_id` text REFERENCES shelves(id) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `library_books_shelf_idx` ON `library_books` (`shelf_id`);
