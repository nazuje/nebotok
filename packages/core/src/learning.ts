import type { BattleContent } from './battle/content.ts';
import { MOVES_PER_CREATURE } from './battle/state.ts';
import type { Progress } from './creatures.ts';
import type { CreatureInstance } from './save.ts';

/** What a creature got from growing: its moves now, the moves added to them, and the moves it must choose about, in learnset order. */
export type MoveLearning = {
  readonly creature: CreatureInstance;
  readonly learned: readonly string[];
  readonly offered: readonly string[];
};

/** A move a team creature may learn by forgetting one of its four: `index` is its team place. */
export type PendingMove = { readonly index: number; readonly move: string };

/**
 * The moves a creature learns by growing from `before` to `after` (the same creature, as `gainXp`
 * returns it): every learnset move above its old level, up to and including its new one, that it
 * does not know yet, in learnset order. While it knows fewer than MOVES_PER_CREATURE moves each is
 * added at once; the rest are offered, for the player to forget a move for or skip.
 */
export function learnMoves(before: CreatureInstance, after: CreatureInstance, content: BattleContent): MoveLearning {
  const learnset = before.species === after.species ? (content.species.get(after.species)?.learnset ?? []) : [];
  const moves = [...after.moves];
  const learned: string[] = [];
  const offered: string[] = [];
  for (const { level, move } of learnset) {
    if (level <= before.level || level > after.level || moves.includes(move) || offered.includes(move)) continue;
    if (moves.length < MOVES_PER_CREATURE) {
      moves.push(move);
      learned.push(move);
    } else offered.push(move);
  }
  return { creature: learned.length > 0 ? { ...after, moves } : after, learned, offered };
}

/**
 * `learnMoves` for a whole team, place by place: `before` and `after` are the same team before and
 * after it gained experience (`awardXp`). Returns the team with the moves learned at once, those
 * moves, and the moves to offer, in team order and then learnset order.
 */
export function learnTeamMoves(before: readonly CreatureInstance[], after: readonly CreatureInstance[], content: BattleContent): { readonly team: CreatureInstance[]; readonly learned: PendingMove[]; readonly offers: PendingMove[] } {
  const learned: PendingMove[] = [];
  const offers: PendingMove[] = [];
  const team = after.map((creature, index) => {
    const was = before[index];
    if (!was) return creature;
    const learning = learnMoves(was, creature, content);
    learned.push(...learning.learned.map((move) => ({ index, move })));
    offers.push(...learning.offered.map((move) => ({ index, move })));
    return learning.creature;
  });
  return { team, learned, offers };
}

/**
 * The creature after the player's answer to an offered move: `forget` is the slot of the move it
 * gives up, and the new move takes that slot; null skips the new move. Null when the answer cannot
 * be done: the slot is empty, or it already knows the move.
 */
export function chooseMove(creature: CreatureInstance, move: string, forget: number | null): CreatureInstance | null {
  if (forget === null) return creature;
  if (!Number.isInteger(forget) || forget < 0 || forget >= creature.moves.length || creature.moves.includes(move)) return null;
  return { ...creature, moves: creature.moves.with(forget, move) };
}

/** `chooseMove` for the team creature at `pending.index`. Null when there is none there or the answer cannot be done. */
export function answerMove(progress: Progress, pending: PendingMove, forget: number | null): Progress | null {
  const creature = progress.team[pending.index];
  const chosen = creature ? chooseMove(creature, pending.move, forget) : null;
  if (!chosen) return null;
  return chosen === creature ? progress : { ...progress, team: progress.team.with(pending.index, chosen) };
}
