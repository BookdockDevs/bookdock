CREATE TABLE personal_metadata_sources (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  api_version INTEGER NOT NULL,
  description TEXT,
  author TEXT,
  repository TEXT,
  origin_type TEXT NOT NULL,
  origin_ref TEXT,
  git_ref TEXT,
  git_commit TEXT,
  entry_path TEXT NOT NULL,
  icon_type TEXT,
  has_detail INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX personal_metadata_sources_user_source_unique ON personal_metadata_sources (user_id, source_id);
