-- Version-level publication metadata overrides (library_book_versions.meta):
-- rarely-queried fields live in JSON, mirroring library_books.meta; a
-- version's effective bookmeta merges these over the work-level overrides and
-- the revision's parsed bookmeta at read time. Null means inherit.
ALTER TABLE library_book_versions ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';
