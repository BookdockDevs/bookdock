CREATE TABLE storage_connections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'webdav',
  endpoint TEXT NOT NULL,
  username TEXT NOT NULL,
  encrypted_password TEXT,
  base_path TEXT NOT NULL DEFAULT '/',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX storage_connections_user_idx ON storage_connections(user_id);
