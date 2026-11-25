import type { ArenaShape, Effectiveness, FightEvent, Side } from '@nebotok/core';
import type { SoundPriority } from '../sound.ts';

/**
 * The sounds of an arena fight: which recipe of content/sounds.json each event plays, for players
 * and watchers alike, from the same events the scene's juice uses (arena-effects.ts). Sound is
 * separate from reduced motion, which never silences it. A frame's events play each sound once
 * and one hit, the strongest, so a flurry stays readable; the burst cap (sound-burst.ts) then drops
 * what is still too much, never before the results, ring-outs, "Go!" and a treat thrown or missed (`keep`).
 */

export type ArenaSound = { readonly id: string; readonly priority: SoundPriority };

/** Each shape family's cast. */
const CAST_SOUNDS: Readonly<Record<ArenaShape, string>> = {
  bolt: 'arena.cast.bolt',
  spray: 'arena.cast.bolt',
  cone: 'arena.cast.cone',
  burst: 'arena.cast.cone',
  lunge: 'arena.cast.lunge',
  strike: 'arena.cast.lunge',
  shield: 'arena.cast.shield',
  wall: 'arena.cast.shield',
  snare: 'arena.cast.snare',
  freeze: 'arena.cast.snare',
  puddle: 'arena.cast.snare',
  zone: 'arena.cast.snare',
  weather: 'arena.cast.weather',
};

/** A hit's pitch tells how well it landed: lower and heavier when strong, higher and lighter when weak. */
const HIT_SOUNDS: Readonly<Record<Effectiveness, string>> = { strong: 'arena.hit.strong', normal: 'arena.hit', weak: 'arena.hit.weak' };
const HIT_RANK: Readonly<Record<Effectiveness, number>> = { weak: 0, normal: 1, strong: 2 };

/** The events that sound the same whoever they happen to. A treat eaten without a befriending is a miss too. */
const EVENT_SOUNDS: Partial<Readonly<Record<FightEvent['kind'], string>>> = {
  dashed: 'arena.dash',
  bumped: 'arena.bump',
  ringOut: 'arena.ringout',
  stormWarning: 'arena.storm.warn',
  stormShrank: 'arena.storm.step',
  treatThrown: 'arena.treat.throw',
  treatEaten: 'arena.treat.miss',
  treatLost: 'arena.treat.miss',
  befriended: 'arena.befriend',
  swapped: 'arena.swap',
  healed: 'arena.heal',
};

export const COUNTDOWN_SOUND = 'arena.countdown';
export const GO_SOUND = 'arena.go';
const ROUND_SOUNDS = { won: 'arena.round.won', lost: 'arena.round.lost' } as const;
const FIGHT_SOUNDS = { won: 'arena.fight.won', lost: 'arena.fight.lost' } as const;
/** The pick screen's last seconds each tick. */
export const COUNTDOWN_FROM_S = 3;

/**
 * The sounds a burst must not drop. A treat thrown, and the miss when it is eaten or lost, answer
 * the player's own press, and only one treat is ever out, so neither is part of a flurry. Thrown
 * point-blank a treat is eaten on the same tick, so its throw shares its frame with the befriending
 * and comes just after the last hits and the befriended creature's cry; a miss is eaten after the
 * hits and casts of its own tick.
 */
const KEPT: ReadonlySet<string> = new Set([...Object.values(ROUND_SOUNDS), ...Object.values(FIGHT_SOUNDS), 'arena.ringout', 'arena.befriend', 'arena.treat.throw', 'arena.treat.miss', GO_SOUND]);

/** Every sound an arena fight can play, for the test that each has its recipe. */
export const ARENA_SOUND_IDS: readonly string[] = [...new Set([...Object.values(CAST_SOUNDS), ...Object.values(HIT_SOUNDS), ...Object.values(EVENT_SOUNDS), ...KEPT, COUNTDOWN_SOUND])];

/** Who hears the fight: the side shown as yours, and whether the page only watches it. */
export type Listener = { readonly side: Side; readonly watching: boolean };

type Ending = Extract<FightEvent, { kind: 'fightEnded' }>['result'];

/**
 * The stinger of a fight's end for `listener`: a fight's result is side 0's, so side 1 hears it
 * the other way round, and a watcher hears every decided fight as won. A befriending's own sound
 * is its stinger; a run, a draw and the time running out have none.
 */
function endingSound(result: Ending, listener: Listener): string | null {
  const won = result === 'won' || result === 'wonByRingOut';
  if (!won && result !== 'lost') return null;
  if (listener.watching) return FIGHT_SOUNDS.won;
  return won === (listener.side === 0) ? FIGHT_SOUNDS.won : FIGHT_SOUNDS.lost;
}

/** A round's end, unless the whole fight ends with it: a round won or lost for `listener`; a level round is played again without one. */
function roundSound(winner: Side | null, listener: Listener): string | null {
  if (winner === null) return null;
  return listener.watching || winner === listener.side ? ROUND_SOUNDS.won : ROUND_SOUNDS.lost;
}

function soundOf(event: FightEvent, listener: Listener, ending: boolean): string | null {
  if (event.kind === 'cast') return CAST_SOUNDS[event.shape];
  if (event.kind === 'roundEnded') return ending ? null : roundSound(event.winner, listener);
  if (event.kind === 'fightEnded') return endingSound(event.result, listener);
  return EVENT_SOUNDS[event.kind] ?? null;
}

/** The sounds one frame's events play, each once, the ones a burst must not drop first. */
export function arenaSounds(events: readonly FightEvent[], listener: Listener): ArenaSound[] {
  const ending = events.some((event) => event.kind === 'fightEnded');
  const ids: string[] = [];
  let hit: Effectiveness | null = null;
  for (const event of events) {
    if (event.kind === 'hit') {
      if (event.damage > 0 && (hit === null || HIT_RANK[event.effectiveness] > HIT_RANK[hit])) hit = event.effectiveness;
      continue;
    }
    const id = soundOf(event, listener, ending);
    if (id !== null) ids.push(id);
  }
  if (hit !== null) ids.push(HIT_SOUNDS[hit]);
  const unique = [...new Set(ids)];
  return [...unique.filter((id) => KEPT.has(id)), ...unique.filter((id) => !KEPT.has(id))].map((id) => ({ id, priority: KEPT.has(id) ? 'keep' : 'normal' }));
}

/**
 * The sounds of a best of 3's phases, from the room's state each frame: a tick for each of the
 * pick screen's last `COUNTDOWN_FROM_S` seconds, and "Go!" as a round's fighting starts after the
 * picks or the pause between rounds. One per fight, since it remembers the phase before.
 */
export function createPhaseSounds(): (phase: string | null, countdownMs: number) => ArenaSound[] {
  let before: string | null = null;
  let second = 0;
  return (phase, countdownMs) => {
    const was = before;
    before = phase;
    if (phase === 'fighting' && (was === 'picking' || was === 'between')) return [{ id: GO_SOUND, priority: 'keep' }];
    if (phase !== 'picking') return [];
    const left = Math.ceil(countdownMs / 1_000);
    const ticked = was === 'picking' && left !== second && left >= 1 && left <= COUNTDOWN_FROM_S;
    second = left;
    return ticked ? [{ id: COUNTDOWN_SOUND, priority: 'normal' }] : [];
  };
}
