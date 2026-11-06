import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { DATABASE_FILE, openDatabase } from './db.ts';
import { createLog, type Log } from './log.ts';
import { createProfileStore, type ProfileStore } from './profiles.ts';
import { createProgressStore, type ProgressStore } from './progress.ts';
import { loadSaveRepair } from './renamed.ts';
import { loadWorld, type WorldContent } from './world.ts';

/** Everything the server keeps besides Colyseus itself: content, the database and the stores on it. */
export type Services = {
  readonly db: DatabaseSync;
  readonly world: WorldContent;
  readonly profiles: ProfileStore;
  readonly progress: ProgressStore;
  readonly now: () => number;
  /** Tests set it to try both starter rules; the room's default is `STARTER_NEEDS_TALK`. */
  readonly starterNeedsTalk?: boolean;
  close(): void;
};

export function createServices(config: Config, now: () => number = Date.now, log: Log = createLog(config.logLevel)): Services {
  const world = loadWorld();
  const db = openDatabase(join(config.dataDir, DATABASE_FILE));
  return {
    db,
    world,
    profiles: createProfileStore({ db, now, avatars: world.avatars, log }),
    progress: createProgressStore({ db, now, repair: loadSaveRepair(log) }),
    now,
    close: () => {
      if (db.isOpen) db.close();
    },
  };
}
