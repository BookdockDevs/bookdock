ALTER TABLE instance ADD COLUMN registration_mode TEXT CHECK (registration_mode IN ('closed', 'invite', 'open'));
--> statement-breakpoint
UPDATE instance SET registration_mode = CASE WHEN allow_registration = 1 THEN 'open' ELSE 'closed' END;
--> statement-breakpoint
CREATE TABLE instance_invites (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (max_uses IS NULL OR max_uses >= 1),
  CHECK (used_count >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX instance_invites_code_unique ON instance_invites (code);
--> statement-breakpoint
CREATE INDEX instance_invites_created_idx ON instance_invites (created_at);
--> statement-breakpoint
CREATE TABLE instance_invite_libraries (
  invite_id TEXT NOT NULL REFERENCES instance_invites(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  PRIMARY KEY (invite_id, library_id)
);
--> statement-breakpoint
CREATE INDEX instance_invite_libraries_library_idx ON instance_invite_libraries (library_id);
