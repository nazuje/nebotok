import type { ArenaStartedMessage, FightEvent, ProgressMessage, TreatStack } from '@nebotok/core';

/**
 * What the page keeps track of in a fight that the arena's state does not show: which of your
 * creatures can still come in for a Swap, and how many treats are left in the bag.
 */
export type FightBook = {
  /** Notes the creatures that came in and fell, and the treats thrown. */
  saw(events: readonly FightEvent[]): void;
  /** Whether another of your creatures can come in instead of the one with fighter id `onIsland`, which the state shows now. */
  canSwap(onIsland: string): boolean;
  /** The moves on the buttons of your creature with fighter id `id`, from your team. */
  loadout(id: string, progress: ProgressMessage | null): readonly (string | null)[] | null;
  /** The treats in your bag, less those thrown in this fight. */
  bag(progress: ProgressMessage | null): TreatStack[];
};

/** `atStart` is the progress as the fight started, for the creatures already too tired to come in. */
export function fightBook(started: ArenaStartedMessage | null, atStart: ProgressMessage | null): FightBook {
  const mine = started ? started.sides[started.side] : [];
  const side = started?.side ?? 0;
  const out = new Set(mine.filter((creature) => creature.place !== null && (atStart?.team[creature.place]?.hp ?? 1) <= 0).map((creature) => creature.id));
  const thrown = new Map<string, number>();
  const placeOf = (id: string) => mine.find((creature) => creature.id === id)?.place ?? null;
  // The creature on the island as the events say: one that falls is followed in by the next.
  let current: string | null = null;
  return {
    saw: (events) => {
      for (const event of events) {
        if (event.kind === 'treatThrown') thrown.set(event.item, (thrown.get(event.item) ?? 0) + 1);
        if (event.kind === 'entered' && event.side === side) current = event.id;
        const fell = (event.kind === 'ringOut' && event.side === side) || (event.kind === 'hit' && event.side === side && event.health <= 0);
        if (fell && current !== null) out.add(current);
      }
    },
    canSwap: (onIsland) => {
      current ??= onIsland;
      return mine.some((creature) => creature.id !== onIsland && !out.has(creature.id));
    },
    loadout: (id, progress) => {
      const place = placeOf(id);
      const creature = place === null ? undefined : progress?.team[place];
      return creature ? creature.loadout : null;
    },
    bag: (progress) => (progress?.inventory ?? []).map(({ item, count }) => ({ item, count: Math.max(0, count - (thrown.get(item) ?? 0)) })),
  };
}
