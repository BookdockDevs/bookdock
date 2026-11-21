CREATE TABLE `theme_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`scope` text DEFAULT 'user' NOT NULL,
	`file_name` text NOT NULL,
	`mime` text NOT NULL,
	`content_hash` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `theme_assets_user_asset_unique` ON `theme_assets` (`user_id`,`asset_id`);
--> statement-breakpoint
CREATE INDEX `theme_assets_asset_scope_idx` ON `theme_assets` (`asset_id`,`scope`);
--> statement-breakpoint
CREATE INDEX `theme_assets_content_hash_idx` ON `theme_assets` (`content_hash`);
--> statement-breakpoint
CREATE TABLE `instance_theme_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instance_theme_items_kind_item_unique` ON `instance_theme_items` (`kind`,`item_id`);
