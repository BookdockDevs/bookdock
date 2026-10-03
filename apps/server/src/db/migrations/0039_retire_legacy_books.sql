CREATE TEMP TABLE `book_retirement_guard` (`violations` INTEGER NOT NULL CHECK (`violations` = 0));
--> statement-breakpoint
INSERT INTO `book_retirement_guard`
SELECT COUNT(*) FROM sqlite_master AS s, pragma_foreign_key_list(s.name) AS f
WHERE s.type = 'table' AND s.name NOT IN ('books', 'shelves', 'tags', 'book_tags', 'annotations')
  AND f."table" IN ('books', 'shelves', 'tags', 'book_tags', 'annotations');
--> statement-breakpoint
INSERT INTO `book_retirement_guard` SELECT COUNT(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE `book_retirement_guard`;
--> statement-breakpoint
DROP TABLE IF EXISTS `annotations`;
--> statement-breakpoint
DROP TABLE IF EXISTS `book_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `books`;
--> statement-breakpoint
DROP TABLE IF EXISTS `shelves`;
--> statement-breakpoint
DROP TABLE IF EXISTS `tags`;
