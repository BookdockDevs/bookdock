-- IANA timezone reported by the client. The Web app renders timestamps in the
-- browser's own zone, so nothing was needed until the Legado book source made
-- the server format a date for a reader it cannot ask. NULL keeps the previous
-- behaviour (UTC) rather than guessing from the container, which is almost
-- always UTC while its owner is not.
ALTER TABLE users ADD COLUMN timezone TEXT;
