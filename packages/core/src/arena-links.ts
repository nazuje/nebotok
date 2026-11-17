import { ARENA_KINDS, arenaReach, type ArenaKind, type ArenaMove, type ArenaRules, type Move, type Species } from './content.ts';

/**
 * The arena checks that need moves.json and species.json beside arena.json (docs/arena.md, "Balance
 * targets"): every move says how it works in the arena, nothing it throws reaches across the island,
 * each kind of button cools down quicker than the next, a dash outruns every creature's walk, and
 * every creature has a move for each button by the level that button unlocks.
 */
export function arenaLinkProblems(arena: ArenaRules, moves: ReadonlyMap<string, Move>, species: ReadonlyMap<string, Species>): string[] {
  return [...moveProblems(arena, moves), ...cooldownProblems(arena, moves), ...[...species.values()].flatMap((entry) => speciesProblems(arena, moves, entry))];
}

/** A move's numbers in the arena: its shape's from arena.json, then the move's own. */
function numbersOf(arena: ArenaRules, { shape, kind, cooldownTicks, ...own }: ArenaMove): Readonly<Record<string, number>> {
  const numbers: Record<string, number> = { ...arena.shapes[shape], cooldownTicks: cooldownTicks ?? arena.kinds[kind].cooldownTicks };
  for (const [key, value] of Object.entries(own)) if (value !== undefined) numbers[key] = value;
  return numbers;
}

function moveProblems(arena: ArenaRules, moves: ReadonlyMap<string, Move>): string[] {
  const diameter = 2 * arena.island.radius;
  const problems: string[] = [];
  for (const move of moves.values()) {
    if (move.arena === undefined) {
      problems.push(`moves.json "${move.id}": needs an arena block with its kind and shape`);
      continue;
    }
    const reach = arenaReach(numbersOf(arena, move.arena));
    if (reach !== undefined && reach >= diameter) problems.push(`moves.json "${move.id}": reaches ${reach}, which must be shorter than the island's diameter (${diameter})`);
  }
  return problems;
}

type Cooling = { readonly id: string; readonly ticks: number };

function cooldownProblems(arena: ArenaRules, moves: ReadonlyMap<string, Move>): string[] {
  const byKind = new Map<ArenaKind, Cooling[]>(ARENA_KINDS.map((kind) => [kind, []]));
  for (const move of moves.values()) {
    if (move.arena) byKind.get(move.arena.kind)?.push({ id: move.id, ticks: numbersOf(arena, move.arena).cooldownTicks ?? 0 });
  }
  const problems: string[] = [];
  ARENA_KINDS.forEach((kind, at) => {
    const next = ARENA_KINDS[at + 1];
    const slowest = (byKind.get(kind) ?? []).toSorted((a, b) => b.ticks - a.ticks)[0];
    const quickest = next === undefined ? undefined : (byKind.get(next) ?? []).toSorted((a, b) => a.ticks - b.ticks)[0];
    if (slowest && quickest && slowest.ticks >= quickest.ticks) {
      problems.push(`moves.json "${slowest.id}": a ${kind} move that cools down in ${slowest.ticks} ticks must be quicker than the ${next} move "${quickest.id}" (${quickest.ticks})`);
    }
  });
  return problems;
}

/** A creature's walking top speed, in units a second: the walk base plus a share of its base speed. */
function walkCap(arena: ArenaRules, entry: Species): number {
  return arena.island.walkBase + Math.floor((arena.island.walkPerSpeedPercent * entry.stats.speed) / 100);
}

function speciesProblems(arena: ArenaRules, moves: ReadonlyMap<string, Move>, entry: Species): string[] {
  const problems: string[] = [];
  const walk = walkCap(arena, entry);
  if (walk >= arena.dash.speed) problems.push(`species.json "${entry.id}": walks at up to ${walk} units a second, so a dash (arena.json dash.speed ${arena.dash.speed}) must be faster`);
  ARENA_KINDS.forEach((kind, button) => {
    const level = arena.buttons[button] ?? 1;
    const learned = [...entry.moves, ...(entry.learnset ?? []).filter((learn) => learn.level <= level).map((learn) => learn.move)];
    if (!learned.some((id) => moves.get(id)?.arena?.kind === kind)) problems.push(`species.json "${entry.id}": learns no ${kind} move by level ${level}, for button ${button + 1}`);
  });
  return problems;
}
