ALTER TABLE content_files ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY COALESCE(idea_id, review_id)
    ORDER BY created_at ASC, id ASC
  ) - 1 AS position
  FROM content_files
  WHERE idea_id IS NOT NULL OR review_id IS NOT NULL
)
UPDATE content_files
SET sort_order = (SELECT position FROM ranked WHERE ranked.id = content_files.id)
WHERE id IN (SELECT id FROM ranked);
