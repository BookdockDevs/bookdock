-- N-06 sidebar sort modes: membership timestamps for shelves and tags.
-- `updated_at` tracks book-membership changes only (renames and reading
-- activity must not bump it); the triggers below are the single touch point.
-- Existing rows are backfilled with the migration moment.
-- `pinned` is an orthogonal sidebar partition flag (pinned-first in every
-- sort mode); pinning must not bump `updated_at`, so no trigger reads it.
ALTER TABLE `shelves` ADD `updated_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `tags` ADD `created_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `tags` ADD `updated_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `shelves` ADD `pinned` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `tags` ADD `pinned` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `shelves` SET `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `updated_at` = 0;
--> statement-breakpoint
UPDATE `tags` SET `created_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000, `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `created_at` = 0;
--> statement-breakpoint
CREATE TRIGGER `book_tags_after_insert_touch_tag` AFTER INSERT ON `book_tags` BEGIN
  UPDATE `tags` SET `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `id` = NEW.`tag_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `book_tags_after_delete_touch_tag` AFTER DELETE ON `book_tags` BEGIN
  UPDATE `tags` SET `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `id` = OLD.`tag_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `books_after_insert_touch_shelf` AFTER INSERT ON `books` WHEN NEW.`shelf_id` IS NOT NULL BEGIN
  UPDATE `shelves` SET `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `id` = NEW.`shelf_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `books_after_update_shelf_touch` AFTER UPDATE OF `shelf_id` ON `books` WHEN NEW.`shelf_id` IS NOT OLD.`shelf_id` BEGIN
  UPDATE `shelves` SET `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `id` = NEW.`shelf_id`;
  UPDATE `shelves` SET `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `id` = OLD.`shelf_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `books_after_update_deleted_at_touch` AFTER UPDATE OF `deleted_at` ON `books` WHEN NEW.`deleted_at` IS NOT OLD.`deleted_at` BEGIN
  UPDATE `shelves` SET `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `id` = NEW.`shelf_id`;
  UPDATE `tags` SET `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `id` IN (SELECT `tag_id` FROM `book_tags` WHERE `book_id` = NEW.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `books_after_delete_touch_shelf` AFTER DELETE ON `books` WHEN OLD.`deleted_at` IS NULL AND OLD.`shelf_id` IS NOT NULL BEGIN
  UPDATE `shelves` SET `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `id` = OLD.`shelf_id`;
END;
