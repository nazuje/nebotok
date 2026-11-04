-- Profiles, their login sessions and their saved progress. Times are milliseconds since 1970 (UTC).

CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  -- The name in lower case, so two names differing only in capitals cannot both exist.
  name_key TEXT NOT NULL UNIQUE,
  avatar TEXT NOT NULL,
  -- scrypt of the 4-digit PIN with this profile's own salt; both NULL when the profile has no PIN.
  pin_hash BLOB,
  pin_salt BLOB,
  failed_pins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  CHECK ((pin_hash IS NULL) = (pin_salt IS NULL))
) STRICT;

-- Only the SHA-256 of each session token is stored; the token itself lives on the player's device.
CREATE TABLE sessions (
  token_hash BLOB PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_by_player ON sessions (player_id);

-- One save per player: the data of a core save envelope (packages/core/src/save.ts) at save_version.
CREATE TABLE player_progress (
  player_id INTEGER PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
  save_version INTEGER NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  updated_at INTEGER NOT NULL
) STRICT;
