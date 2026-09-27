-- Shared-library access control: password-protected libraries keep only a
-- scrypt hash server-side (never exposed through shared contracts), and
-- versions carry their own guest-readable flag so a public library can still
-- hide individual texts from anonymous readers.
ALTER TABLE `libraries` ADD `access_password_hash` text;
--> statement-breakpoint
ALTER TABLE `book_versions` ADD `guest_readable` integer NOT NULL DEFAULT 0;
