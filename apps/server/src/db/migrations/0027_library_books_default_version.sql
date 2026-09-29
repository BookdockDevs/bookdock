-- Default display version of a work (LibraryBook.default_version_link_id): when
-- a work carries several versions, the grid card, list row and detail dialog
-- lead with this version instead of the oldest upload. Null = oldest first.
-- The reference survives version deletes via SET NULL, never orphaning a row.
ALTER TABLE library_books ADD COLUMN default_version_link_id TEXT REFERENCES library_book_versions(id) ON DELETE SET NULL;
