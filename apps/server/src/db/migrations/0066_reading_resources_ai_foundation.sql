-- Reading resources and AI foundation.
--
-- Reading resources (TOC rules, global text replacements, speech services) gain
-- an explicit availability column so a definition can be published to the
-- instance independently of the owner's personal enable/order choices. Personal
-- choices live in the owner's `settings` documents, so a consumer never mutates
-- the publisher's row.
--
-- Speech services additionally gain the explicit display order that used to be
-- "most recently edited first", and the abandoned development-only
-- tts_services_user_sort_idx / enabled additions are folded into this single
-- tail migration (nothing was released between 0065 and here).
--
-- Quick commands follow the same split: `ai_prompts` holds the definitions and
-- the per-account switch/order moves into the `aiPrompts` settings value.

ALTER TABLE `toc_rules` ADD COLUMN `availability` TEXT NOT NULL DEFAULT 'user';
--> statement-breakpoint
CREATE INDEX `toc_rules_availability_idx` ON `toc_rules` (`availability`);
--> statement-breakpoint
ALTER TABLE `text_replacements` ADD COLUMN `availability` TEXT NOT NULL DEFAULT 'user';
--> statement-breakpoint
CREATE INDEX `text_replacements_availability_idx` ON `text_replacements` (`availability`);
--> statement-breakpoint
-- Per-book overrides used to be unique per (book, rule), which collides as soon
-- as two accounts override the same shared rule on the same shared book.
DROP INDEX IF EXISTS `text_replacement_overrides_book_replacement_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `text_replacement_overrides_user_book_replacement_unique` ON `text_replacement_overrides` (`user_id`, `book_id`, `replacement_id`);
--> statement-breakpoint
ALTER TABLE `tts_services` ADD COLUMN `availability` TEXT NOT NULL DEFAULT 'user';
--> statement-breakpoint
DROP INDEX IF EXISTS `tts_services_user_sort_idx`;
--> statement-breakpoint
ALTER TABLE `tts_services` ADD COLUMN `sort_order` INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Existing rows keep the order users saw before this migration (newest-updated
-- first); new rows append at max(sort_order)+10.
UPDATE `tts_services` SET `sort_order` = (
  SELECT COUNT(*) FROM `tts_services` AS `newer`
  WHERE `newer`.`user_id` = `tts_services`.`user_id`
    AND (`newer`.`updated_at` > `tts_services`.`updated_at`
      OR (`newer`.`updated_at` = `tts_services`.`updated_at`
        AND `newer`.`id` < `tts_services`.`id`))
) * 10;
--> statement-breakpoint
CREATE INDEX `tts_services_availability_idx` ON `tts_services` (`availability`);
--> statement-breakpoint
CREATE TABLE `ai_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `provider` text NOT NULL,
  `base_url` text,
  `encrypted_api_key` text,
  `availability` text NOT NULL DEFAULT 'user',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_connections_user_updated_idx` ON `ai_connections` (`user_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `ai_connections_availability_idx` ON `ai_connections` (`availability`);
--> statement-breakpoint
CREATE TABLE `ai_models` (
  `id` text PRIMARY KEY NOT NULL,
  `connection_id` text NOT NULL REFERENCES `ai_connections`(`id`) ON DELETE CASCADE,
  `upstream_model_id` text NOT NULL,
  `name` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `capabilities` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_models_connection_upstream_unique` ON `ai_models` (`connection_id`, `upstream_model_id`);
--> statement-breakpoint
-- Quick commands leave the personal `ai` settings array and become definition
-- rows with one owner, so a published command can be shared without copying its
-- text into every account's document. Enablement and order stay personal (in
-- the `aiPrompts` settings value); the legacy arrays are converted at boot by
-- `migrateLegacyAiPrompts`, which keeps the existing ids, text, scope, switch
-- and order of every account.
CREATE TABLE `ai_prompts` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `seed_key` text,
  `name` text NOT NULL,
  `prompt` text NOT NULL,
  `scope` text NOT NULL DEFAULT 'both',
  `enabled` integer NOT NULL DEFAULT 1,
  `sort_order` integer NOT NULL DEFAULT 0,
  `availability` text NOT NULL DEFAULT 'user',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_prompts_user_order_idx` ON `ai_prompts` (`user_id`, `sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_prompts_user_seed_key_unique` ON `ai_prompts` (`user_id`, `seed_key`);
--> statement-breakpoint
CREATE INDEX `ai_prompts_availability_idx` ON `ai_prompts` (`availability`);
