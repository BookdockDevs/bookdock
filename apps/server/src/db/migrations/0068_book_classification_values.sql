-- Categories and tags become values on the book, not rows with a lifetime.
--
-- A category is a name path of one or two names and a tag is a bare name, so
-- both can live on the book that carries them: `category_root` / `category_leaf`
-- hold the path and `library_book_tag_values` holds the tag names. Nothing else
-- needs an identity, which is why this release also drops library_categories,
-- library_tags and library_book_tags — the copy runs in
-- book-classification-migration.ts, in the same transaction as the drop.
--
-- What does still deserve a row is the sidebar's *preference* about a value:
-- hidden, pinned, and manual order survive clearing and renaming, so they live
-- in library_metadata_value_state keyed by (library, kind, value).

ALTER TABLE `library_books` ADD `category_root` text;
--> statement-breakpoint
ALTER TABLE `library_books` ADD `category_leaf` text;
--> statement-breakpoint
CREATE TABLE `library_book_tag_values` (
	`id` text PRIMARY KEY NOT NULL,
	`library_book_id` text NOT NULL REFERENCES `library_books`(`id`) ON DELETE cascade,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_book_tag_values_book_name_unique` ON `library_book_tag_values` (`library_book_id`,`name`);
--> statement-breakpoint
CREATE INDEX `library_book_tag_values_name_idx` ON `library_book_tag_values` (`name`,`library_book_id`);
--> statement-breakpoint
CREATE TABLE `library_metadata_value_state` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL REFERENCES `libraries`(`id`) ON DELETE cascade,
	`kind` text NOT NULL CHECK (`kind` IN ('category', 'tag')),
	`value` text NOT NULL,
	`sort_order` integer NOT NULL DEFAULT 0,
	`pinned` integer NOT NULL DEFAULT 0,
	`hidden` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_metadata_value_state_unique` ON `library_metadata_value_state` (`library_id`,`kind`,`value`);
--> statement-breakpoint
CREATE INDEX `library_metadata_value_state_sort_idx` ON `library_metadata_value_state` (`library_id`,`kind`,`sort_order`);
