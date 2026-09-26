-- Phase 3 book pin: the legacy books.pinned_at sort-first flag moves to the
-- version row so private cards keep their order after the model switch.
ALTER TABLE `library_book_versions` ADD `pinned_at` integer;
