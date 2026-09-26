-- Bookmarks need the TOC href like highlights and ideas do: duplicate
-- chapter labels (e.g. two "第二十七章") are only distinguishable by href.
-- The column was missing from the start, so creates carried the href in the
-- response without persisting it, and reads always returned null.
ALTER TABLE `bookmarks` ADD `chapter_href` text;
