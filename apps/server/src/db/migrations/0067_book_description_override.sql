-- Card-local description override.
--
-- A collected card keeps its own library_books row while the content (and the
-- revision meta that carries the description) belongs to the shared library.
-- Rewriting that revision is exactly what the immutable-content boundary
-- forbids, so "I want my own summary for this book" needs a column on the card.
--
-- `description` already exists but holds the snapshot copied at collect time,
-- which cannot distinguish "inherited" from "the user wrote this". Null means
-- inherit: reads fall back to the revision's bookmeta.description.

ALTER TABLE `library_books` ADD COLUMN `description_override` TEXT;
