// A save written straight into the database of a server the check started itself, before the
// player first joins: the way a test begins a player part way through the game (a worn-out team, a
// creature waiting at the shrine) without any way in through the server. The server reads it like
// any save when the player joins. Only a check that owns the server's DATA_DIR can do this; a
// server given by --url keeps its database to itself.
import { join } from 'node:path';
import { DATABASE_FILE, openDatabase } from '../../apps/server/src/db.ts';
import { createProgressStore } from '../../apps/server/src/progress.ts';
import { createSave } from '../../packages/core/src/index.ts';

function withDatabase(dataDir, use) {
  const db = openDatabase(join(dataDir, DATABASE_FILE));
  try {
    use(db);
  } finally {
    db.close();
  }
}

/** Writes `data` (a whole save's data, checked like every save) as the save of profile `playerId`. */
export function prepareSave(dataDir, playerId, data) {
  withDatabase(dataDir, (db) => createProgressStore({ db, now: Date.now, rename: (same) => same }).save(playerId, createSave(data)));
}

/**
 * Deletes a signed-out profile with its save, as `admin.ts delete` does from its own process, so a
 * check that prepares a player for every run stays inside the server's limit of profiles.
 */
export function deleteProfile(dataDir, playerId) {
  withDatabase(dataDir, (db) => db.prepare('DELETE FROM players WHERE id = ?').run(playerId));
}
