import type { DatabaseSync } from 'node:sqlite';
import { migrateSave, type SaveData, type SaveFile } from '@nebotok/core';

export type ProgressStore = {
  /**
   * The player's save upgraded to the current version, with renamed species replaced, or null when
   * they have none yet. Throws SaveError on a save it cannot read.
   */
  load(playerId: number): SaveFile | null;
  save(playerId: number, save: SaveFile): void;
};

export function createProgressStore({ db, now, rename }: { db: DatabaseSync; now: () => number; rename: (data: SaveData) => SaveData }): ProgressStore {
  const select = db.prepare('SELECT save_version, data FROM player_progress WHERE player_id = ?');
  const upsert = db.prepare(`
    INSERT INTO player_progress (player_id, save_version, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (player_id) DO UPDATE SET save_version = excluded.save_version, data = excluded.data, updated_at = excluded.updated_at
  `);
  return {
    load(playerId) {
      const row = select.get(playerId) as { save_version: number; data: string } | undefined;
      if (!row) return null;
      const save = migrateSave({ v: row.save_version, data: JSON.parse(row.data) as unknown });
      return { ...save, data: rename(save.data) };
    },
    save(playerId, save) {
      upsert.run(playerId, save.v, JSON.stringify(save.data), now());
    },
  };
}
