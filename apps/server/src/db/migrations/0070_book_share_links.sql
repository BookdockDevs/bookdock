CREATE TABLE book_share_links (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES library_book_versions(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES content_revisions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  encrypted_token TEXT NOT NULL,
  duration TEXT NOT NULL,
  expires_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX book_share_links_source_user_unique ON book_share_links(source_id, user_id);
--> statement-breakpoint
CREATE INDEX book_share_links_user_idx ON book_share_links(user_id);
--> statement-breakpoint
CREATE INDEX book_share_links_revision_idx ON book_share_links(revision_id);
--> statement-breakpoint
CREATE TRIGGER book_share_links_on_trash AFTER UPDATE OF deleted_at ON library_books
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
BEGIN
  DELETE FROM book_share_links WHERE source_id IN (
    SELECT id FROM library_book_versions WHERE library_book_id = NEW.id
  );
END;
--> statement-breakpoint
CREATE TRIGGER book_share_links_on_new_revision AFTER INSERT ON content_revisions
BEGIN
  DELETE FROM book_share_links WHERE revision_id IN (
    SELECT id FROM content_revisions
    WHERE book_version_id = NEW.book_version_id AND revision_no < NEW.revision_no
  );
END;
--> statement-breakpoint
CREATE TRIGGER book_share_links_on_source_change AFTER UPDATE OF book_version_id, library_book_id, library_id, kind ON library_book_versions
WHEN OLD.book_version_id <> NEW.book_version_id OR OLD.library_book_id <> NEW.library_book_id
  OR OLD.library_id <> NEW.library_id OR OLD.kind <> NEW.kind
BEGIN
  DELETE FROM book_share_links WHERE source_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER book_share_links_on_membership_delete AFTER DELETE ON library_memberships
WHEN OLD.role = 'admin'
BEGIN
  DELETE FROM book_share_links WHERE user_id = OLD.user_id AND source_id IN (
    SELECT lv.id FROM library_book_versions lv JOIN libraries l ON l.id = lv.library_id
    WHERE lv.library_id = OLD.library_id AND l.user_id <> OLD.user_id
  );
END;
--> statement-breakpoint
CREATE TRIGGER book_share_links_on_membership_demote AFTER UPDATE OF role ON library_memberships
WHEN OLD.role = 'admin' AND NEW.role <> 'admin'
BEGIN
  DELETE FROM book_share_links WHERE user_id = OLD.user_id AND source_id IN (
    SELECT lv.id FROM library_book_versions lv JOIN libraries l ON l.id = lv.library_id
    WHERE lv.library_id = OLD.library_id AND l.user_id <> OLD.user_id
  );
END;
--> statement-breakpoint
CREATE TRIGGER book_share_links_on_owner_change AFTER UPDATE OF user_id ON libraries
WHEN NEW.user_id <> OLD.user_id
BEGIN
  DELETE FROM book_share_links WHERE user_id = OLD.user_id AND source_id IN (
    SELECT id FROM library_book_versions WHERE library_id = NEW.id
  ) AND (NEW.type = 'private' OR NOT EXISTS (
    SELECT 1 FROM library_memberships WHERE library_id = NEW.id AND user_id = OLD.user_id AND role = 'admin'
  ));
END;
--> statement-breakpoint
CREATE TRIGGER book_share_links_on_disable AFTER UPDATE OF disabled ON users
WHEN OLD.disabled = 0 AND NEW.disabled = 1
BEGIN
  DELETE FROM book_share_links WHERE user_id = NEW.id;
END;
