DROP INDEX IF EXISTS `highlights_user_version_cfi_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `highlights_user_version_cfi_unique`
  ON `highlights` (`user_id`, `book_version_id`, COALESCE(`revision_id`, ''), `cfi_range`)
  WHERE `relocation` = 'ok';
--> statement-breakpoint
DROP INDEX IF EXISTS `bookmarks_user_version_cfi_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_user_version_cfi_unique`
  ON `bookmarks` (`user_id`, `book_version_id`, COALESCE(`revision_id`, ''), `cfi`)
  WHERE `relocation` = 'ok';
