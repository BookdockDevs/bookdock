-- Reading facts are private to users and survive source version deletion.
CREATE TABLE reading_archives (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_version_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  legacy_intervals TEXT NOT NULL DEFAULT '[]',
  legacy_daily TEXT NOT NULL DEFAULT '[]',
  legacy_word_count INTEGER,
  legacy_revision_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, book_version_id)
);
--> statement-breakpoint
CREATE TABLE reading_rounds (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_version_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reading',
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX reading_rounds_user_version_ordinal_idx ON reading_rounds(user_id, book_version_id, ordinal);
--> statement-breakpoint
CREATE UNIQUE INDEX reading_rounds_active_idx ON reading_rounds(user_id, book_version_id) WHERE status = 'reading';
--> statement-breakpoint
CREATE TABLE reading_timer_claims (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  activity_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO reading_archives(user_id, book_version_id, title, author, legacy_intervals, created_at, updated_at)
SELECT identities.user_id, identities.book_version_id,
  COALESCE((SELECT COALESCE(lbv.title, lb.title) FROM library_book_versions lbv
    JOIN library_books lb ON lb.id = lbv.library_book_id
    JOIN libraries l ON l.id = lb.library_id
    WHERE lbv.book_version_id = identities.book_version_id AND lb.user_id = identities.user_id
      AND l.type = 'private' ORDER BY lbv.id LIMIT 1), 'Unavailable book'),
  COALESCE((SELECT COALESCE(lbv.author, lb.author) FROM library_book_versions lbv
    JOIN library_books lb ON lb.id = lbv.library_book_id
    JOIN libraries l ON l.id = lb.library_id
    WHERE lbv.book_version_id = identities.book_version_id AND lb.user_id = identities.user_id
      AND l.type = 'private' ORDER BY lbv.id LIMIT 1), ''),
  COALESCE((SELECT CASE WHEN json_valid(bs.progress_data)
    THEN CASE WHEN json_type(bs.progress_data, '$.intervals') = 'array'
      THEN json_extract(bs.progress_data, '$.intervals') ELSE '[]' END ELSE '[]' END
    FROM book_states bs WHERE bs.user_id = identities.user_id AND bs.book_version_id = identities.book_version_id), '[]'),
  COALESCE((SELECT MIN(started_at) FROM reading_sessions rs
    WHERE rs.user_id = identities.user_id AND COALESCE(rs.book_version_id, rs.book_id) = identities.book_version_id AND started_at > 0),
    (SELECT updated_at FROM book_states bs WHERE bs.user_id = identities.user_id AND bs.book_version_id = identities.book_version_id AND updated_at > 0), CAST(strftime('%s','now') AS INTEGER) * 1000),
  COALESCE((SELECT updated_at FROM book_states bs WHERE bs.user_id = identities.user_id AND bs.book_version_id = identities.book_version_id AND updated_at > 0), CAST(strftime('%s','now') AS INTEGER) * 1000)
FROM (
  SELECT user_id, COALESCE(book_version_id, book_id) AS book_version_id FROM reading_records WHERE duration_seconds > 0
  UNION SELECT user_id, COALESCE(book_version_id, book_id) FROM reading_sessions WHERE duration_seconds > 0
  UNION SELECT user_id, book_version_id FROM book_states
    WHERE last_read_at > 0 OR read_fraction > 0 OR percent > 0 OR cfi IS NOT NULL
      OR read_status IN ('finished', 'abandoned')
      OR CASE WHEN json_valid(progress_data) THEN json_array_length(progress_data, '$.intervals') > 0 ELSE 0 END
) identities;
--> statement-breakpoint
UPDATE reading_archives SET legacy_daily = COALESCE((
  SELECT json_group_array(json_object('date', residual.date, 'durationSeconds', residual.duration_seconds))
  FROM (SELECT rr.date, MAX(0, rr.duration_seconds - COALESCE((SELECT SUM(rs.duration_seconds)
    FROM reading_sessions rs WHERE rs.user_id = rr.user_id AND COALESCE(rs.book_version_id,rs.book_id) = COALESCE(rr.book_version_id,rr.book_id)
      AND rs.date = rr.date), 0)) AS duration_seconds
    FROM reading_records rr WHERE rr.user_id = reading_archives.user_id
      AND COALESCE(rr.book_version_id,rr.book_id) = reading_archives.book_version_id) residual
  WHERE residual.duration_seconds > 0
), '[]'), legacy_word_count = (SELECT cr.word_count FROM content_revisions cr
  WHERE cr.book_version_id = reading_archives.book_version_id ORDER BY cr.revision_no DESC LIMIT 1),
legacy_revision_id = (SELECT cr.id FROM content_revisions cr
  WHERE cr.book_version_id = reading_archives.book_version_id ORDER BY cr.revision_no DESC LIMIT 1);
--> statement-breakpoint
-- Existing coverage has no session provenance; retain it as a baseline only.
INSERT INTO reading_rounds(id, user_id, book_version_id, ordinal, status, started_at, ended_at)
SELECT 'rrd_' || lower(hex(randomblob(12))), a.user_id, a.book_version_id, 1,
  CASE WHEN bs.read_status IN ('finished', 'abandoned') THEN bs.read_status ELSE 'reading' END,
  a.created_at, CASE WHEN bs.read_status IN ('finished', 'abandoned') THEN CASE WHEN bs.updated_at > 0 THEN bs.updated_at ELSE a.updated_at END ELSE NULL END
FROM reading_archives a LEFT JOIN book_states bs
  ON bs.user_id = a.user_id AND bs.book_version_id = a.book_version_id;
--> statement-breakpoint
CREATE TABLE reading_records_new (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  book_version_id TEXT,
  date TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO reading_records_new(id,user_id,book_id,book_version_id,date,duration_seconds)
SELECT id,user_id,book_id,book_version_id,date,duration_seconds FROM reading_records;
--> statement-breakpoint
DROP TABLE reading_records;
--> statement-breakpoint
ALTER TABLE reading_records_new RENAME TO reading_records;
--> statement-breakpoint
CREATE UNIQUE INDEX reading_records_user_book_date_idx ON reading_records(user_id, book_id, date);
--> statement-breakpoint
CREATE INDEX reading_records_user_date_idx ON reading_records(user_id, date);
--> statement-breakpoint
CREATE INDEX reading_records_book_version_idx ON reading_records(book_version_id);
--> statement-breakpoint
CREATE TABLE reading_sessions_new (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  book_version_id TEXT,
  date TEXT NOT NULL,
  started_at INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  ended_at INTEGER,
  start_cfi TEXT,
  end_cfi TEXT,
  start_fraction REAL,
  end_fraction REAL,
  start_chapter_index INTEGER,
  end_chapter_index INTEGER,
  request_id TEXT,
  body_hash TEXT,
  source TEXT NOT NULL DEFAULT 'legacy',
  round_id TEXT REFERENCES reading_rounds(id) ON DELETE CASCADE,
  timezone TEXT,
  fragments TEXT NOT NULL DEFAULT '[]',
  coverage TEXT NOT NULL DEFAULT '[]',
  revision_id TEXT,
  word_count INTEGER
);
--> statement-breakpoint
INSERT INTO reading_sessions_new(id,user_id,book_id,book_version_id,date,started_at,duration_seconds,ended_at,
  start_cfi,end_cfi,start_fraction,end_fraction,start_chapter_index,end_chapter_index,round_id)
SELECT s.id,s.user_id,s.book_id,s.book_version_id,s.date,s.started_at,s.duration_seconds,s.ended_at,
  s.start_cfi,s.end_cfi,s.start_fraction,s.end_fraction,s.start_chapter_index,s.end_chapter_index,
  (SELECT r.id FROM reading_rounds r WHERE r.user_id = s.user_id AND r.book_version_id = COALESCE(s.book_version_id,s.book_id) AND r.ordinal = 1)
FROM reading_sessions s;
--> statement-breakpoint
DROP TABLE reading_sessions;
--> statement-breakpoint
ALTER TABLE reading_sessions_new RENAME TO reading_sessions;
--> statement-breakpoint
CREATE INDEX reading_sessions_user_date_idx ON reading_sessions(user_id,date);
--> statement-breakpoint
CREATE INDEX reading_sessions_book_version_idx ON reading_sessions(book_version_id);
--> statement-breakpoint
CREATE INDEX reading_sessions_round_idx ON reading_sessions(round_id);
--> statement-breakpoint
CREATE UNIQUE INDEX reading_sessions_user_request_idx ON reading_sessions(user_id,request_id);
--> statement-breakpoint
CREATE TABLE reading_write_receipts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  session_id TEXT REFERENCES reading_sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  PRIMARY KEY(user_id,request_id)
);
--> statement-breakpoint
CREATE INDEX reading_write_receipts_user_version_idx ON reading_write_receipts(user_id,book_version_id);
--> statement-breakpoint
INSERT INTO reading_write_receipts(user_id,request_id,book_version_id,body_hash,session_id,status)
SELECT user_id,request_id,COALESCE(book_version_id,book_id),body_hash,id,'accepted'
FROM reading_sessions WHERE request_id IS NOT NULL AND body_hash IS NOT NULL;
