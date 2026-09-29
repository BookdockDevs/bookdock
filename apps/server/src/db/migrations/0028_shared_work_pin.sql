ALTER TABLE library_books ADD COLUMN pinned_at INTEGER;
--> statement-breakpoint
UPDATE library_books SET pinned_at = (
  SELECT MAX(v.pinned_at) FROM library_book_versions v
  WHERE v.library_book_id = library_books.id
) WHERE library_id IN (SELECT id FROM libraries WHERE type = 'shared');
