-- Retirement accepts an initialized current instance or an empty fresh database.
-- Named constraints make unsupported/lossy upgrade inputs fail explicitly.
CREATE TABLE `identity_retirement_guard` (
  `valid_instance_owner` integer NOT NULL CHECK (`valid_instance_owner` = 1),
  `guest_has_no_credentials_or_profile` integer NOT NULL CHECK (`guest_has_no_credentials_or_profile` = 1),
  `guest_settings_are_seed_markers` integer NOT NULL CHECK (`guest_settings_are_seed_markers` = 1),
  `guest_rules_are_unmodified_seeds` integer NOT NULL CHECK (`guest_rules_are_unmodified_seeds` = 1),
  `guest_has_no_library_book_versions_user_id` integer NOT NULL CHECK (`guest_has_no_library_book_versions_user_id` = 1),
  `guest_has_no_fonts_user_id` integer NOT NULL CHECK (`guest_has_no_fonts_user_id` = 1),
  `guest_has_no_tts_services_user_id` integer NOT NULL CHECK (`guest_has_no_tts_services_user_id` = 1),
  `guest_has_no_ai_messages_user_id` integer NOT NULL CHECK (`guest_has_no_ai_messages_user_id` = 1),
  `guest_has_no_ai_generation_runs_user_id` integer NOT NULL CHECK (`guest_has_no_ai_generation_runs_user_id` = 1),
  `guest_has_no_ai_message_events_user_id` integer NOT NULL CHECK (`guest_has_no_ai_message_events_user_id` = 1),
  `guest_has_no_legado_access_keys_user_id` integer NOT NULL CHECK (`guest_has_no_legado_access_keys_user_id` = 1),
  `guest_has_no_access_tokens_user_id` integer NOT NULL CHECK (`guest_has_no_access_tokens_user_id` = 1),
  `guest_has_no_libraries_user_id` integer NOT NULL CHECK (`guest_has_no_libraries_user_id` = 1),
  `guest_has_no_library_memberships_user_id` integer NOT NULL CHECK (`guest_has_no_library_memberships_user_id` = 1),
  `guest_has_no_library_categories_user_id` integer NOT NULL CHECK (`guest_has_no_library_categories_user_id` = 1),
  `guest_has_no_library_books_user_id` integer NOT NULL CHECK (`guest_has_no_library_books_user_id` = 1),
  `guest_has_no_library_tags_user_id` integer NOT NULL CHECK (`guest_has_no_library_tags_user_id` = 1),
  `guest_has_no_book_states_user_id` integer NOT NULL CHECK (`guest_has_no_book_states_user_id` = 1),
  `guest_has_no_highlights_user_id` integer NOT NULL CHECK (`guest_has_no_highlights_user_id` = 1),
  `guest_has_no_bookmarks_user_id` integer NOT NULL CHECK (`guest_has_no_bookmarks_user_id` = 1),
  `guest_has_no_ideas_user_id` integer NOT NULL CHECK (`guest_has_no_ideas_user_id` = 1),
  `guest_has_no_reading_records_user_id` integer NOT NULL CHECK (`guest_has_no_reading_records_user_id` = 1),
  `guest_has_no_reading_sessions_user_id` integer NOT NULL CHECK (`guest_has_no_reading_sessions_user_id` = 1),
  `guest_has_no_ai_threads_user_id` integer NOT NULL CHECK (`guest_has_no_ai_threads_user_id` = 1),
  `guest_has_no_ai_book_indexes_user_id` integer NOT NULL CHECK (`guest_has_no_ai_book_indexes_user_id` = 1),
  `guest_has_no_ai_chunks_user_id` integer NOT NULL CHECK (`guest_has_no_ai_chunks_user_id` = 1),
  `guest_has_no_ai_chunk_embeddings_user_id` integer NOT NULL CHECK (`guest_has_no_ai_chunk_embeddings_user_id` = 1),
  `guest_has_no_text_replacements_user_id` integer NOT NULL CHECK (`guest_has_no_text_replacements_user_id` = 1),
  `guest_has_no_text_replacement_overrides_user_id` integer NOT NULL CHECK (`guest_has_no_text_replacement_overrides_user_id` = 1),
  `guest_has_no_library_invites_user_id` integer NOT NULL CHECK (`guest_has_no_library_invites_user_id` = 1)
);
--> statement-breakpoint
INSERT INTO `identity_retirement_guard` SELECT
  ((NOT EXISTS (SELECT 1 FROM users WHERE role <> 'guest') AND NOT EXISTS (SELECT 1 FROM instance)) OR ((SELECT count(*) FROM instance) = 1 AND EXISTS (SELECT 1 FROM instance i JOIN users u ON u.id = i.owner_user_id WHERE i.id = 'instance' AND u.role <> 'guest' AND u.disabled = 0 AND length(u.password_hash) > 0))),
  (NOT EXISTS (SELECT 1 FROM users WHERE role = 'guest' AND (password_hash IS NOT NULL OR avatar_key IS NOT NULL OR bio <> ''))),
  (NOT EXISTS (SELECT 1 FROM settings WHERE user_id IN (SELECT id FROM users WHERE role = 'guest') AND (key NOT IN ('tocRuleSeedOrderV8', 'tocRuleSeeded') OR value <> '1'))),
  (NOT EXISTS (SELECT 1 FROM toc_rules WHERE user_id IN (SELECT id FROM users WHERE role = 'guest') AND (seed_key IS NULL OR seed_key NOT IN ('toc.en', 'toc.numeric', 'toc.zh-hierarchy') OR updated_at <> created_at OR enabled <> 1))),
  (NOT EXISTS (SELECT 1 FROM "library_book_versions" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "fonts" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "tts_services" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "ai_messages" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "ai_generation_runs" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "ai_message_events" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "legado_access_keys" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "access_tokens" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "libraries" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "library_memberships" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "library_categories" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "library_books" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "library_tags" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "book_states" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "highlights" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "bookmarks" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "ideas" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "reading_records" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "reading_sessions" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "ai_threads" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "ai_book_indexes" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "ai_chunks" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "ai_chunk_embeddings" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "text_replacements" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "text_replacement_overrides" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest'))),
  (NOT EXISTS (SELECT 1 FROM "library_invites" WHERE "user_id" IN (SELECT id FROM users WHERE role = 'guest')));
--> statement-breakpoint
DROP TABLE `identity_retirement_guard`;
--> statement-breakpoint
DELETE FROM `settings` WHERE user_id IN (SELECT id FROM users WHERE role = 'guest');
--> statement-breakpoint
DELETE FROM `toc_rules` WHERE user_id IN (SELECT id FROM users WHERE role = 'guest');
--> statement-breakpoint
DELETE FROM `sessions` WHERE user_id IN (SELECT id FROM users WHERE role = 'guest');
--> statement-breakpoint
DELETE FROM `users` WHERE role = 'guest';
--> statement-breakpoint
UPDATE `instance` SET allow_registration = 0, allow_guest_access = 0;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `role`;
--> statement-breakpoint
DROP TABLE `instance_settings`;
