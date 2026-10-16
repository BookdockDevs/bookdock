ALTER TABLE book_states ADD COLUMN progress_data TEXT;
--> statement-breakpoint
ALTER TABLE book_states ADD COLUMN read_fraction REAL NOT NULL DEFAULT 0;
