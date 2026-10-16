CREATE TABLE interaction_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('idea', 'review')),
  event TEXT NOT NULL CHECK (event IN ('comment', 'reply', 'like')),
  target_id TEXT NOT NULL,
  interaction_id TEXT NOT NULL,
  comment_id TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  CHECK (user_id <> actor_id)
);
--> statement-breakpoint
CREATE INDEX interaction_notifications_user_idx ON interaction_notifications(user_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX interaction_notifications_event_unique ON interaction_notifications(user_id, actor_id, domain, event, interaction_id);
--> statement-breakpoint
CREATE TABLE interaction_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('idea', 'review')),
  request_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_id TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX interaction_receipts_request_unique ON interaction_receipts(user_id, domain, request_id);
