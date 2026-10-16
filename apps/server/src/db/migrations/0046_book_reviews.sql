CREATE TABLE book_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  private_library_book_id TEXT REFERENCES library_books(id) ON DELETE CASCADE,
  source_library_id TEXT,
  source_library_book_id TEXT,
  rating_halves INTEGER CHECK (rating_halves IS NULL OR (rating_halves >= 1 AND rating_halves <= 10)),
  body TEXT,
  body_format TEXT NOT NULL DEFAULT 'markdown',
  visibility TEXT NOT NULL DEFAULT 'private',
  read_listing_id TEXT,
  read_book_version_id TEXT,
  read_revision_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  edited_at INTEGER,
  CHECK (
    (private_library_book_id IS NOT NULL AND source_library_id IS NULL AND source_library_book_id IS NULL)
    OR (private_library_book_id IS NULL AND source_library_id IS NOT NULL AND source_library_book_id IS NOT NULL)
  ),
  CHECK (rating_halves IS NOT NULL OR (body IS NOT NULL AND body <> ''))
);
--> statement-breakpoint
CREATE UNIQUE INDEX book_reviews_source_user_unique ON book_reviews(source_library_id, source_library_book_id, user_id) WHERE source_library_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX book_reviews_private_unique ON book_reviews(private_library_book_id) WHERE private_library_book_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX book_reviews_source_idx ON book_reviews(source_library_id, source_library_book_id, visibility);
--> statement-breakpoint
CREATE INDEX book_reviews_user_idx ON book_reviews(user_id, updated_at);
--> statement-breakpoint
CREATE TABLE book_review_comments (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES book_reviews(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES book_review_comments(id) ON DELETE CASCADE,
  reply_to_id TEXT REFERENCES book_review_comments(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER
);
--> statement-breakpoint
CREATE INDEX book_review_comments_review_idx ON book_review_comments(review_id, created_at);
--> statement-breakpoint
CREATE TABLE book_review_likes (
  review_id TEXT NOT NULL REFERENCES book_reviews(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(review_id, user_id)
);
--> statement-breakpoint
CREATE TABLE book_review_comment_likes (
  comment_id TEXT NOT NULL REFERENCES book_review_comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(comment_id, user_id)
);
--> statement-breakpoint
CREATE TRIGGER book_review_comments_deleted_author BEFORE DELETE ON users
BEGIN
  UPDATE book_review_comments SET parent_id = NULL WHERE parent_id IN (SELECT id FROM book_review_comments WHERE user_id = OLD.id);
  DELETE FROM book_review_comments WHERE user_id = OLD.id;
END;
