import {
  DIRECTIONS,
  NARRATOR,
  findPath,
  isWalkable,
  nextGoal,
  npcInReach,
  npcMarks,
  samePoint,
  stepFrom,
  type BoardJob,
  type Direction,
  type Language,
  type Mood,
  type NpcMark,
  type Point,
  type ProgressMessage,
  type StoryContent,
  type StoryProgress,
  type TalkNode,
  type WorldMap,
} from '@nebotok/core';

/** A line of a talk as the talk box shows it, in one language. */
export type TalkLine = {
  /** The character who says it, or null for the narrator. */
  readonly speaker: string | null;
  readonly name: string | null;
  readonly say: string;
  readonly mood: Mood | null;
  /** The choices `talk.node` shows, in its order: what each says and the index to answer with. */
  readonly choices: readonly { readonly say: string; readonly index: number }[];
  /** How quickly the speaker talks, 1 (slow) to 3 (quick). */
  readonly pace: number;
};

/** The words of the node a `talk.node` names, or null when this page's content does not know it. */
export function talkLine(talk: Pick<TalkNode, 'npc' | 'node' | 'choices'>, content: StoryContent, language: Language): TalkLine | null {
  const node = content.dialogue.get(talk.npc)?.nodes[talk.node];
  if (!node) return null;
  const speakerId = node.speaker ?? talk.npc;
  const speaker = speakerId === NARRATOR ? null : (content.npcs.get(speakerId) ?? null);
  const choices = talk.choices.flatMap((index) => {
    const choice = node.choices?.[index];
    return choice ? [{ say: choice.say[language], index }] : [];
  });
  return {
    speaker: speaker?.id ?? null,
    name: speaker?.name[language] ?? null,
    say: node.say[language],
    mood: node.mood ?? null,
    choices,
    pace: speaker?.voice.pace ?? content.npcs.get(talk.npc)?.voice.pace ?? 2,
  };
}

/** The portrait frame for a mood: the mood's own when the portrait has one, else `neutral`. */
export function portraitFrame(frames: readonly string[], mood: Mood | null): string {
  return mood !== null && frames.includes(mood) ? mood : 'neutral';
}

/** Letters typed per second at each `voice.pace`. */
export const LETTERS_PER_SECOND: Readonly<Record<number, number>> = { 1: 28, 2: 40, 3: 56 };

/** How many letters of a line `length` long are typed `elapsedMs` after it began, at `pace`. */
export function typedLength(length: number, elapsedMs: number, pace: number): number {
  const perSecond = LETTERS_PER_SECOND[pace] ?? LETTERS_PER_SECOND[2]!;
  return Math.min(length, Math.max(0, Math.floor((elapsedMs * perSecond) / 1_000)));
}

/** Something on the map a courier walks up to and uses: a character, a gathering spot or a station. */
export type Target = { readonly kind: 'npc' | 'spot' | 'station'; readonly id: string };

const idAt = (points: Readonly<Record<string, Point>>, tile: Point): string | null => Object.entries(points).find(([, at]) => samePoint(at, tile))?.[0] ?? null;

/** The character standing on `tile`, if any. */
export function npcAt(map: WorldMap, tile: Point): string | null {
  return idAt(map.npcs, tile);
}

/** The character, gathering spot or station on `tile`, if any. */
export function targetAt(map: WorldMap, tile: Point): Target | null {
  const npc = idAt(map.npcs, tile);
  if (npc !== null) return { kind: 'npc', id: npc };
  const spot = idAt(map.spots, tile);
  if (spot !== null) return { kind: 'spot', id: spot };
  const station = idAt(map.stations, tile);
  return station === null ? null : { kind: 'station', id: station };
}

/** Where a target stands on `map`, or null when it is not on it. */
export function targetTile(map: WorldMap, target: Target): Point | null {
  const points = target.kind === 'npc' ? map.npcs : target.kind === 'spot' ? map.spots : map.stations;
  return points[target.id] ?? null;
}

/** The character on the tile your courier faces from `tile`, if any. */
export function facedNpc(map: WorldMap, tile: Point, facing: Direction): string | null {
  return npcAt(map, stepFrom(tile, facing));
}

/** The character, spot or station on the tile your courier faces from `tile`, if any. */
export function facedTarget(map: WorldMap, tile: Point, facing: Direction): Target | null {
  return targetAt(map, stepFrom(tile, facing));
}

/**
 * Where to stand to talk to `npc` from `from`: `from` itself when already beside them, else the
 * free neighbour of theirs with the shortest walk that `canReach` accepts. Null when none is.
 */
export function talkSpot(map: WorldMap, from: Point, npc: string, canReach: (tile: Point) => boolean): Point | null {
  const at = map.npcs[npc];
  if (!at) return null;
  if (npcInReach(map, from, npc)) return from;
  return standBeside(map, from, at, canReach);
}

/**
 * Where to stand to use what is on `at` from `from`: `from` itself when it is next to `at`, not
 * diagonally, else the free neighbour of `at` with the shortest walk that `canReach` accepts.
 * Null when none is.
 */
export function standBeside(map: WorldMap, from: Point, at: Point, canReach: (tile: Point) => boolean): Point | null {
  if (Math.abs(from.x - at.x) + Math.abs(from.y - at.y) === 1) return from;
  const spots = DIRECTIONS.map((direction) => stepFrom(at, direction)).flatMap((tile) => {
    if (!isWalkable(map, tile) || !canReach(tile)) return [];
    const path = findPath(map, from, tile);
    return path ? [{ tile, steps: path.length }] : [];
  });
  return spots.toSorted((a, b) => a.steps - b.steps)[0]?.tile ?? null;
}

/** The way a character on `from` turns to look at someone on `to`, by the longer axis. */
export function facingToward(from: Point, to: Point): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy < 0 ? 'up' : 'down';
}

export type HeadMark = NpcMark['mark'];

/**
 * The marks over characters' heads: core's `npcMarks`, and for a player with no creature yet a
 * new-quest mark on the character who offers the starter, so a new player knows whom to see. A
 * character with a delivery from the job `board` that the bag holds all of gets a turn-in mark.
 */
export function headMarks(progress: ProgressMessage | null, story: StoryProgress | null, content: StoryContent, board: readonly BoardJob[] | null = null): ReadonlyMap<string, HeadMark> {
  if (!progress || !story) return new Map();
  // Storage comes only at a shrine; the marks look only at the team, the story and the board's
  // jobs, so the board's seed and counts, which the client never gets, can be anything.
  const full = { ...progress, storage: [], story, skills: [], jobs: board ? { seed: 0, drawn: 0, done: 0, board } : null };
  if (progress.needsStarter) {
    const goal = nextGoal(full, content);
    return new Map(goal?.kind === 'starter' ? [[goal.npc, 'newQuest' as const]] : []);
  }
  return new Map(npcMarks(full, content).map(({ npc, mark }) => [npc, mark]));
}

/** The character a new player should go to for their first creature, or null once they have one. */
export function starterNpc(progress: ProgressMessage | null, story: StoryProgress | null, content: StoryContent): string | null {
  if (!progress?.needsStarter || !story) return null;
  const goal = nextGoal({ ...progress, storage: [], story, skills: [], jobs: null }, content);
  return goal?.kind === 'starter' ? goal.npc : null;
}
