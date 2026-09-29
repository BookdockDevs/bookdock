-- Operator-run city switches: whether ordinary members may open new shared
-- libraries and upload files to their private library. Both default open so
-- existing instances keep their behavior; the instance owner always bypasses.
ALTER TABLE instance ADD COLUMN allow_user_create_library INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE instance ADD COLUMN allow_user_upload INTEGER NOT NULL DEFAULT 1;
