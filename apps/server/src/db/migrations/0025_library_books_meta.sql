-- Work-level publication metadata (LibraryBook.meta): rarely-queried fields live
-- in JSON, mirroring books.meta; effective.bookmeta merges these over the
-- revision's parsed bookmeta at read time.
ALTER TABLE library_books ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';
