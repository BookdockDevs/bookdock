-- Ideas keep the author's color/style like highlights do; the annotation
-- split dropped them, so every idea read back yellow/underlined. The anchor
-- restores precise positioning for the single legacy row that carries one.
-- Defaults mirror the legacy create path (yellow/underline).
ALTER TABLE `ideas` ADD `color` text NOT NULL DEFAULT 'yellow';
--> statement-breakpoint
ALTER TABLE `ideas` ADD `style` text NOT NULL DEFAULT 'underline';
--> statement-breakpoint
ALTER TABLE `ideas` ADD `cfi_anchor` text;
