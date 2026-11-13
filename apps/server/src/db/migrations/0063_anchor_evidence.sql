-- Annotation anchor migration evidence: surviving portions of an annotation's
-- originally quoted range after a partial anchor migration (see architecture.md
-- "Content editing and revision mapping"). Nullable JSON without FKs: evidence
-- must outlive what it points at, like revisionId.
ALTER TABLE highlights ADD COLUMN anchor_evidence TEXT;
--> statement-breakpoint
ALTER TABLE bookmarks ADD COLUMN anchor_evidence TEXT;
--> statement-breakpoint
ALTER TABLE ideas ADD COLUMN anchor_evidence TEXT;
