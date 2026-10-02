-- Pins the deleted re-pin flow left behind can never catch up: the reader
-- acknowledges the pinned revision while hasUnreadUpdate compares against the
-- newest one, so a lagging pin nags forever with no way to follow. Every
-- content writer now moves all collected pins in the same transaction, so any
-- pin older than its version's newest revision is definitionally stale: move
-- it forward once. Idempotent; NULL pins already read the newest revision.
UPDATE "library_book_versions" SET "pinned_revision_id" = (
  SELECT "id" FROM "content_revisions"
  WHERE "content_revisions"."book_version_id" = "library_book_versions"."book_version_id"
  ORDER BY "revision_no" DESC LIMIT 1
) WHERE "kind" = 'shared'
  AND "pinned_revision_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "content_revisions"
    WHERE "content_revisions"."book_version_id" = "library_book_versions"."book_version_id"
  )
  AND "pinned_revision_id" <> (
    SELECT "id" FROM "content_revisions"
    WHERE "content_revisions"."book_version_id" = "library_book_versions"."book_version_id"
    ORDER BY "revision_no" DESC LIMIT 1
  );
