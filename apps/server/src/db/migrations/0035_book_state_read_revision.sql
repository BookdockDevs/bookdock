-- Which content revision a reader last actually opened.
--
-- The pin now follows the newest revision for every holder, so the pin can no
-- longer tell one reader from another: it moves for all of them at once. This
-- column is what makes "there is an update you have not read" answerable per
-- account — the newest revision differing from the one this reader last opened
-- is exactly that condition. Nullable: null means "never opened the reader",
-- which reads as "has an update" once any revision exists.
ALTER TABLE `book_states` ADD `read_revision_id` text;
