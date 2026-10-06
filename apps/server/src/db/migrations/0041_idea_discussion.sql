ALTER TABLE ideas ADD COLUMN source_library_book_version_id TEXT;
--> statement-breakpoint
ALTER TABLE ideas ADD COLUMN revision_id TEXT;
--> statement-breakpoint
ALTER TABLE ideas ADD COLUMN edited_at INTEGER;
--> statement-breakpoint
CREATE TABLE idea_comments (
  id TEXT PRIMARY KEY NOT NULL,
  idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES idea_comments(id) ON DELETE CASCADE,
  reply_to_id TEXT REFERENCES idea_comments(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER
);
--> statement-breakpoint
CREATE INDEX idea_comments_idea_idx ON idea_comments(idea_id, created_at);
--> statement-breakpoint
CREATE TABLE idea_likes (
  idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(idea_id, user_id)
);
--> statement-breakpoint
CREATE TABLE idea_comment_likes (
  comment_id TEXT NOT NULL REFERENCES idea_comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(comment_id, user_id)
);
--> statement-breakpoint
CREATE TRIGGER idea_comments_deleted_author BEFORE DELETE ON users
BEGIN
  UPDATE idea_comments SET parent_id = NULL WHERE parent_id IN (SELECT id FROM idea_comments WHERE user_id = OLD.id);
  DELETE FROM idea_comments WHERE user_id = OLD.id;
END;
