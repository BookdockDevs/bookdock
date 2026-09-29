-- Persistent hide flags: work-level (library_books) plus taxonomy-level
-- (library_categories/library_tags). The visibility rule is evaluated at read
-- time (work.hidden OR hidden category subtree OR any hidden tag), so no data
-- backfill is needed and later-filed works hide automatically.
ALTER TABLE `library_books` ADD `hidden` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `library_categories` ADD `hidden` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `library_tags` ADD `hidden` integer NOT NULL DEFAULT 0;
