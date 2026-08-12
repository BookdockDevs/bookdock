ALTER TABLE `books` ADD `shelf_id` text REFERENCES `shelves`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
UPDATE `books` SET `shelf_id` = (
	SELECT bs.`shelf_id` FROM `book_shelves` bs
	JOIN `shelves` s ON s.`id` = bs.`shelf_id`
	WHERE bs.`book_id` = `books`.`id`
	ORDER BY s.`sort_order` ASC, s.`created_at` ASC, s.`id` ASC
	LIMIT 1
) WHERE EXISTS (SELECT 1 FROM `book_shelves` bs WHERE bs.`book_id` = `books`.`id`);
--> statement-breakpoint
CREATE INDEX `books_shelf_idx` ON `books` (`shelf_id`);
--> statement-breakpoint
DROP TABLE `book_shelves`;
