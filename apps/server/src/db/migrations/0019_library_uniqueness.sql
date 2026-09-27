-- Library and B uniqueness backstops (review S1-7): exactly one private
-- library per user, and at most one shared (B) reference per BookVersion per
-- library. Both are partial indexes so shared-library ownership and
-- legitimate A/C duplicates keep working. Service code re-checks inside its
-- write transactions and treats a constraint hit as "already exists".
CREATE UNIQUE INDEX `libraries_private_user_unique` ON `libraries` (`user_id`) WHERE "libraries"."type" = 'private';
--> statement-breakpoint
CREATE UNIQUE INDEX `library_book_versions_shared_unique` ON `library_book_versions` (`library_id`,`book_version_id`) WHERE "library_book_versions"."kind" = 'shared';
