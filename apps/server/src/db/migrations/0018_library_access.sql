-- Shared-library access control: a password-protected library keeps the access
-- password twice — `access_password` in plaintext so the owner can read it back
-- and re-share it, and `access_password_hash` (scrypt) as the value the join
-- path verifies against. Only the plaintext column reaches the shared contract,
-- and only for the owner. Versions carry their own guest-readable flag so a
-- public library can still hide individual texts from anonymous readers.
ALTER TABLE `libraries` ADD `access_password` text;
--> statement-breakpoint
ALTER TABLE `libraries` ADD `access_password_hash` text;
--> statement-breakpoint
ALTER TABLE `book_versions` ADD `guest_readable` integer NOT NULL DEFAULT 0;
