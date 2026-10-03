-- Global text-replacement execution order. Queries never had an ORDER BY, so
-- the effective order was insertion order while the settings page showed
-- newest-first: display and execution disagreed. New rules append at
-- max(sort_order)+1; existing rows receive a deterministic per-user order
-- by created_at and id. Historical chained output is not preserved.
ALTER TABLE "text_replacements" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "text_replacements" SET "sort_order" = (
  SELECT COUNT(*) FROM "text_replacements" AS "older"
  WHERE "older"."user_id" = "text_replacements"."user_id"
    AND ("older"."created_at" < "text_replacements"."created_at"
      OR ("older"."created_at" = "text_replacements"."created_at"
        AND "older"."id" < "text_replacements"."id"))
);
