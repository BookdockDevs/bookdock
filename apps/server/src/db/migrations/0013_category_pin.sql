-- Phase 3 sidebar pin: categories need the same pin-to-top flag shelves have
-- so pinned shelves keep leading every sort mode after the model switch.
ALTER TABLE `library_categories` ADD `pinned` integer NOT NULL DEFAULT 0;
