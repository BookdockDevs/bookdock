-- Multi-author metadata: `authors` carries the full author list as a JSON
-- string array, `author` stays as its derived first-author mirror for
-- sort/filter/search. Existing single-author rows backfill to one element;
-- empty authors stay []. Version rows keep null = inherit the work default.
ALTER TABLE `library_books` ADD `authors` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
UPDATE `library_books` SET `authors` = json_array(`author`) WHERE `author` IS NOT NULL AND `author` <> '';
--> statement-breakpoint
ALTER TABLE `library_book_versions` ADD `authors` text;
--> statement-breakpoint
UPDATE `library_book_versions` SET `authors` = json_array(`author`) WHERE `author` IS NOT NULL AND `author` <> '';
