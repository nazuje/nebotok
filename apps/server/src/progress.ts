import type { DatabaseSync } from 'node:sqlite';
import { migrateSave, type SaveFile } from '@nebotok/core';
import type { SaveRepair } from './renamed.ts';

export type ProgressStore = {
  /**
   * The player's save upgraded to the current version and repaired against today's content
   * (`loadSaveRepair`), or null when they have none yet. Throws on a save it cannot read.
   */
  load(playerId: number): SaveFile | null;
  save(playerId: number, save: SaveFile): void;
};

export function createProgressStore({ db, now, repair }: { db: DatabaseSync; now: () => number; repair: SaveRepair }): ProgressStore {
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
      return { ...save, data: repair(playerId, save.data) };
    },
    save(playerId, save) {
      upsert.run(playerId, save.v, JSON.stringify(save.data), now());
    },
  };
}
