CREATE TABLE IF NOT EXISTS `library_invites` (
  `id` text PRIMARY KEY NOT NULL,
  `library_id` text NOT NULL REFERENCES `libraries`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `token` text NOT NULL,
  `created_at` integer NOT NULL,
  `revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `library_invites_library_unique` ON `library_invites` (`library_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `library_invites_token_unique` ON `library_invites` (`token`);
