-- Localized display names for uploaded fonts: per-Windows-LANGID name records
-- extracted from the sfnt name table at upload time. Nullable JSON — rows
-- uploaded before this migration keep their cross-language family as the only
-- display name.
ALTER TABLE fonts ADD COLUMN local_names TEXT;
