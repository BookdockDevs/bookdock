-- Per-listing guest readability: the anonymous switch moves from the shared
-- content identity (book_versions) onto each library's listing
-- (library_book_versions), so one library opening its copy to guests can no
-- longer open another library's copy of the same version. Existing open
-- versions propagate to every listing before the old column is dropped.
ALTER TABLE `library_book_versions` ADD `guest_readable` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `library_book_versions` SET `guest_readable` = 1 WHERE `book_version_id` IN (SELECT `id` FROM `book_versions` WHERE `guest_readable` = 1);
--> statement-breakpoint
ALTER TABLE `book_versions` DROP COLUMN `guest_readable`;
