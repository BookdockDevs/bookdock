-- Phase 3 revision metadata: content-derived and per-book data (chapters,
-- word counts, embedded metadata, reader prefs, TOC rule pins) moves from
-- books.meta to the revision that produced it. Existing rows are backfilled
-- by the library migration service, never here: backfill needs row mapping
-- the SQL layer cannot verify.
ALTER TABLE `content_revisions` ADD `meta` text NOT NULL DEFAULT '{}';
