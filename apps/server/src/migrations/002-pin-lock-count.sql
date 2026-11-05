-- How many times in a row a profile has been locked for wrong PINs. Each lock lasts twice as long as
-- the one before (up to a cap); a right PIN, or a new or removed PIN, sets it back to 0.

ALTER TABLE players ADD COLUMN lock_count INTEGER NOT NULL DEFAULT 0;
