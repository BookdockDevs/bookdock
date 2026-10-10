ALTER TABLE `storage_connections` ADD COLUMN `region` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `storage_connections` ADD COLUMN `bucket` text DEFAULT '' NOT NULL;
