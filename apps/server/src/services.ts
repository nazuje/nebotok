import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { DATABASE_FILE, openDatabase } from './db.ts';
import { createProfileStore, type ProfileStore } from './profiles.ts';
import { createProgressStore, type ProgressStore } from './progress.ts';
import { loadWorld, type WorldContent } from './world.ts';

/** Everything the server keeps besides Colyseus itself: content, the database and the stores on it. */
export type Services = {
  readonly db: DatabaseSync;
  readonly world: WorldContent;
  readonly profiles: ProfileStore;
  readonly progress: ProgressStore;
  readonly now: () => number;
  close(): void;
};

export function createServices(config: Config, now: () => number = Date.now): Services {
  const world = loadWorld();
  const db = openDatabase(join(config.dataDir, DATABASE_FILE));
  return {
    db,
    world,
    profiles: createProfileStore({ db, now, avatars: world.avatars }),
    progress: createProgressStore({ db, now }),
    now,
    close: () => {
      if (db.isOpen) db.close();
    },
  };
}
