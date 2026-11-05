import type { Move, Species } from '../content.ts';
import type { BattleContent } from './content.ts';
import { BattleError, type BattleCreature, type Effectiveness, type FieldEffect, type FieldWeather } from './state.ts';

/** Stats grow with level in whole numbers, so every engine agrees on them. */
function statAt(base: number, level: number): number {
  return Math.floor((2 * base * level) / 100) + 5;
}

/** A creature's full health at a level. */
export function maxHpAt(species: Species, level: number): number {
  return Math.floor((2 * species.stats.hp * level) / 100) + level + 10;
}

export function battleCreature(id: string, species: Species, level: number): BattleCreature {
  const maxHp = maxHpAt(species, level);
  return {
    id,
    species: species.id,
    type: species.type,
    level,
    moves: species.moves,
    maxHp,
    hp: maxHp,
    attack: statAt(species.stats.attack, level),
    defense: statAt(species.stats.defense, level),
    speed: statAt(species.stats.speed, level),
  };
}

export function moveOf(content: BattleContent, id: string): Move {
  const move = content.moves.get(id);
  if (!move) throw new BattleError(`unknown move "${id}"`);
  return move;
}

export function effectivenessOf(content: BattleContent, moveType: string, targetType: string): Effectiveness {
  const type = content.weather.get(moveType);
  if (type?.strongAgainst.includes(targetType)) return 'strong';
  if (type?.weakAgainst.includes(targetType)) return 'weak';
  return 'normal';
}

export function fieldEffectOf(content: BattleContent, weather: FieldWeather | null, moveType: string): FieldEffect {
  const field = weather ? content.weather.get(weather.type)?.field : undefined;
  if (field?.boosts.includes(moveType)) return 'boosted';
  if (field?.weakens.includes(moveType)) return 'weakened';
  return 'none';
}

export type DamageRoll = {
  readonly damage: number;
  readonly effectiveness: Effectiveness;
  readonly field: FieldEffect;
};

const scale = (amount: number, percent: number): number => Math.floor((amount * percent) / 100);

/**
 * The damage a move does, before accuracy. `rollPercent` is the random part, from the rules'
 * `minRollPercent` to 100. Every step rounds down, and a move with power always does at least 1.
 */
export function damageOf(content: BattleContent, attacker: BattleCreature, target: BattleCreature, move: Move, weather: FieldWeather | null, rollPercent: number): DamageRoll {
  const { rules } = content;
  const effectiveness = effectivenessOf(content, move.type, target.type);
  const field = fieldEffectOf(content, weather, move.type);
  if (move.power === 0) return { damage: 0, effectiveness, field };
  const levelFactor = Math.floor((2 * attacker.level) / 5) + 2;
  let damage = Math.floor(Math.floor((levelFactor * move.power * attacker.attack) / target.defense) / 50) + 2;
  if (move.type === attacker.type) damage = scale(damage, rules.sameTypePercent);
  if (effectiveness === 'strong') damage = scale(damage, rules.strongPercent);
  if (effectiveness === 'weak') damage = scale(damage, rules.weakPercent);
  if (field === 'boosted') damage = scale(damage, rules.boostPercent);
  if (field === 'weakened') damage = scale(damage, rules.weakenPercent);
  return { damage: Math.max(1, scale(damage, rollPercent)), effectiveness, field };
}
