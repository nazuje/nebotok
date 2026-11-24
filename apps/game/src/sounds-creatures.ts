import { speciesCry, type Species } from '@nebotok/core';
import { CONTENT } from './battle-content.ts';
import type { SoundPlayer } from './sound-player.ts';

/** How long after one cry the next asked for with it starts, so both are heard. */
export const CRY_GAP_MS = 500;

/** What the test hook records a cry as: `cry:<species>`. */
export const cryLabel = (species: string): string => `cry:${species}`;

export type Cries = {
  /** `species` cries, after any cry asked for just before it. A species this page does not know is silent. */
  cry(species: string, now: number): void;
  /** A creature came onto the field: it cries the first time its `key` is seen in `scope`. A new scope forgets the keys of the one before. */
  entered(scope: string, key: string, species: string, now: number): void;
  /** Called every frame: plays the next cry waiting, once the one before has had its turn. */
  frame(now: number): void;
  /** Forgets the cries waiting and the creatures seen, as when the player leaves the world. */
  reset(): void;
};

/**
 * Creature cries (core `speciesCry`), when a wild creature appears, a starter is picked, a creature
 * is befriended and a creature comes onto the arena's island. Played only while sounds are on.
 */
export function createCries(sound: Pick<SoundPlayer, 'playRecipe'>, species: (id: string) => Species | undefined = (id) => CONTENT.species.get(id)): Cries {
  let waiting: string[] = [];
  let nextAt = 0;
  let scope: string | null = null;
  let seen = new Set<string>();

  const frame = (now: number) => {
    if (now < nextAt) return;
    const next = waiting.shift();
    const kind = next === undefined ? undefined : species(next);
    if (next === undefined || kind === undefined) return;
    sound.playRecipe(cryLabel(next), speciesCry(kind));
    nextAt = now + CRY_GAP_MS;
  };
  const cry = (id: string, now: number) => {
    if (species(id) === undefined) return;
    waiting.push(id);
    frame(now);
  };

  return {
    cry,
    entered: (within, key, id, now) => {
      if (within !== scope) {
        scope = within;
        seen = new Set();
      }
      if (seen.has(key)) return;
      seen.add(key);
      cry(id, now);
    },
    frame,
    reset: () => {
      waiting = [];
      nextAt = 0;
      scope = null;
      seen = new Set();
    },
  };
}
