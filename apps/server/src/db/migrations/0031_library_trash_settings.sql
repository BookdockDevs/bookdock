-- Shared-library trash settings (per-library, owner-only). NULL keeps the
-- previous behaviour (trash on, 30d retention, unlimited capacity); private
-- library rows stay NULL and never read these columns.
ALTER TABLE libraries ADD COLUMN trash_enabled INTEGER;
--> statement-breakpoint
ALTER TABLE libraries ADD COLUMN trash_auto_clean_days INTEGER;
--> statement-breakpoint
ALTER TABLE libraries ADD COLUMN trash_max_bytes INTEGER;
