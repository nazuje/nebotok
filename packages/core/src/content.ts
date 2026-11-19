import { z } from 'zod';
import { ARENA_KINDS, ARENA_SHAPES } from './arena-shapes.ts';
import { Tint } from './art.ts';
import { MapId } from './map.ts';
import { WELCOME_MESSAGE_KEYS } from './protocol.ts';

export const LANGUAGES = ['en', 'sl'] as const;
export type Language = (typeof LANGUAGES)[number];
export const LanguageSchema = z.enum(LANGUAGES);

const Text = z.string().trim().min(1);

export const LocalizedText = z.strictObject({ en: Text, sl: Text });
export type LocalizedText = z.infer<typeof LocalizedText>;

/** Dotted lower-camel ids, such as `connection.unreachable`. */
const StringId = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, 'ids look like "area.name"');

/** Every id the client or the rules ask for, so a missing line fails validation, not a player's screen. */
export const REQUIRED_STRING_IDS = [
  'game.title',
  'connection.connecting',
  'connection.connected',
  'connection.unreachable',
  'connection.reconnecting',
  'connection.replaced',
  'connection.signedOut',
  'connection.outdated',
  'update.reload',
  'update.available',
  'language.en',
  'language.sl',
  'language.switch',
  'profile.title',
  'profile.new',
  'profile.name',
  'profile.nameHint',
  'profile.avatar',
  'profile.pin',
  'profile.pinHint',
  'profile.pinPrompt',
  'profile.create',
  'profile.play',
  'profile.back',
  'profile.switch',
  'profile.locked',
  'profile.empty',
  'profile.hasPin',
  'profile.pinChoose',
  'profile.pinSet',
  'profile.pinRemove',
  'profile.pinDelete',
  'profile.retry',
  'profile.time.minute',
  'profile.time.minutes.one',
  'profile.time.minutes.two',
  'profile.time.minutes.few',
  'profile.time.minutes.other',
  'profile.time.about',
  'profile.time.hour',
  'profile.pinNudge',
  'profile.takenOver',
  'profile.pinAgain',
  'profile.pinMismatch',
  'profile.pinAdded',
  'profile.done',
  'settings.open',
  'settings.close',
  'settings.language',
  'settings.controls',
  'settings.controls.tap',
  'settings.controls.joystick',
  'settings.addPin',
  'settings.readToMe',
  'settings.readToMe.off',
  'settings.readToMe.on',
  'speech.play',
  'profile.error.nameInvalid',
  'profile.error.nameTaken',
  'profile.error.pinInvalid',
  'profile.error.pinWrong',
  'profile.error.locked',
  'profile.error.full',
  'profile.error.busy',
  'profile.error.signedOut',
  'profile.error.hasPin',
  'profile.error.unknown',
  'bag.title',
  'bag.hint',
  'bag.empty',
  'bag.kind.quest',
  'bag.kind.treat',
  'bag.kind.ingredient',
  'bag.kind.material',
  'bag.count',
  'bag.forQuest',
  'bag.treatAbout',
  'journal.title',
  'journal.news',
  'journal.empty',
  'journal.chapterDone',
  'journal.done',
  'journal.battles',
  'journal.befriends',
  'journal.continued',
  'journal.whereNext',
  'quest.started',
  'quest.stepDone',
  'quest.done',
  'quest.rewardItem',
  'quest.rewardXp',
  'quest.noRoom',
  ...WELCOME_MESSAGE_KEYS,
  'battle.wildAppeared',
  'battle.moves',
  'battle.team',
  'battle.treat',
  'battle.run',
  'battle.chooseNext',
  'battle.treatRefused',
  'battle.befriended',
  'battle.befriendedStored',
  'battle.ranAway',
  'battle.teamFainted',
  'starter.title',
  'shrine.rested',
  'refused.notInBattle',
  'refused.inBattle',
  'refused.notNow',
  'refused.noItem',
  'refused.notAtShrine',
  'refused.full',
  'refused.invalid',
  'refused.tooFar',
  'refused.notTalking',
  'refused.resting',
  'refused.needsLevel',
  'refused.bagFull',
  'battle.go',
  'battle.used',
  'battle.missed',
  'battle.strong',
  'battle.weak',
  'battle.fainted',
  'battle.weather',
  'battle.weatherEnded',
  'battle.treatTaken',
  'battle.treatOrDone',
  'battle.done',
  'battle.treatLater',
  'battle.noTreats',
  'battle.treats',
  'battle.favouriteTag',
  'battle.favourite',
  'battle.back',
  'battle.won',
  'battle.over',
  'battle.interrupted',
  'battle.xp',
  'battle.xpGained',
  'battle.levelUp',
  'battle.learned',
  'learn.wants',
  'learn.new',
  'learn.forget',
  'learn.skip',
  'learn.forgetMove',
  'learn.swap',
  'learn.confirm',
  'learn.back',
  'battle.level',
  'battle.health',
  'battle.resting',
  'battle.out',
  'battle.continue',
  'team.title',
  'team.close',
  'team.hint',
  'storage.title',
  'storage.empty',
  'storage.take',
  'storage.store',
  'storage.keepOne',
  'storage.pickFirst',
  'starter.hint',
  'talk.close',
  'storm.skip',
  'storm.caption',
  'skill.dip.hint',
  'skill.dip.pull',
  'skill.sparkle.hint',
  'skill.sparkle.place',
  'skill.marker.hint',
  'skill.marker.stop',
  'skill.waiting',
  'skill.perfect',
  'skill.success',
  'skill.miss',
  'skill.tryAgain',
  'skill.gained',
  'skill.count',
  'skill.levelUp',
  'skill.resting',
  'skill.needsLevel',
  'skill.bagFull',
  'skill.noItem',
  'book.title',
  'book.cook',
  'book.have',
  'book.strength',
  'book.locked',
  'journal.quests',
  'journal.skills',
  'skills.level',
  'skills.xp',
  'skills.top',
  'skills.next',
  'skills.empty',
  'jobs.verb.gather',
  'jobs.verb.catch',
  'jobs.verb.cook',
  'jobs.verb.deliver',
  'jobs.count',
  'jobs.to',
  'jobs.progress',
  'jobs.inBag',
  'jobs.rewards',
  'jobs.rewardXp',
  'jobs.hint',
  'jobs.toastProgress',
  'jobs.toastDone',
  'jobs.xpGain',
  'jobs.more',
  'arena.shape.bolt',
  'arena.shape.spray',
  'arena.shape.cone',
  'arena.shape.snare',
  'arena.shape.lunge',
  'arena.shape.burst',
  'arena.shape.puddle',
  'arena.shape.shield',
  'arena.shape.strike',
  'arena.shape.wall',
  'arena.shape.freeze',
  'arena.shape.zone',
  'arena.shape.weather',
  'arena.kind.quick',
  'arena.kind.special',
  'arena.kind.ultimate',
  'arena.dash',
  'arena.treat',
  'arena.swap',
  'arena.leave',
  'arena.locked',
  'arena.turtle',
  'arena.ringOut',
  'arena.move',
  'arena.button',
  'arena.emptyButton',
  'arena.timeUp',
  'arena.pickTitle',
  'arena.go',
  'arena.roundSlot',
  'arena.score',
  'loadout.title',
  'loadout.hint',
  'loadout.empty',
  'loadout.power',
  'loadout.saved',
  'loadout.done',
  'loadout.try',
  'loadout.newMove',
  'loadout.learned',
  'duel.challenge',
  'duel.accept',
  'duel.decline',
  'duel.watch',
  'duel.evenMatch',
  'duel.realLevels',
] as const;
export type StringId = (typeof REQUIRED_STRING_IDS)[number];

export const StringsFile = z.record(StringId, LocalizedText).superRefine((strings, ctx) => {
  for (const id of REQUIRED_STRING_IDS) {
    if (!(id in strings)) ctx.addIssue({ code: 'custom', message: `missing string "${id}"`, path: [id] });
  }
});
export type Strings = Readonly<Record<StringId, LocalizedText>> & Readonly<Record<string, LocalizedText>>;

export function parseStrings(raw: unknown): Strings {
  return StringsFile.parse(raw) as Strings;
}

/** Settings for the whole world: where players start and how fast everyone walks. */
export const WorldSettings = z.strictObject({
  startMap: MapId,
  walkTilesPerSecond: z.number().int().min(1).max(12),
});
export type WorldSettings = z.infer<typeof WorldSettings>;

const AvatarId = z.string().regex(/^[a-z][a-z0-9-]{0,19}$/, 'avatar ids are short lowercase words');
/** A look a profile can pick. Its courier is the sprite `couriers/<id>` in `content/art/`. */
export const Avatar = z.strictObject({
  id: AvatarId,
  name: LocalizedText,
});
export type Avatar = z.infer<typeof Avatar>;

export const AvatarsFile = z
  .strictObject({ avatars: z.array(Avatar).min(2).max(16) })
  .superRefine(({ avatars }, ctx) => {
    const ids = avatars.map((avatar) => avatar.id);
    ids.forEach((id, at) => {
      if (ids.indexOf(id) !== at) ctx.addIssue({ code: 'custom', message: `avatar "${id}" appears twice`, path: ['avatars', at, 'id'] });
    });
  });
export type AvatarsFile = z.infer<typeof AvatarsFile>;

/** Ids of creatures, moves and weather types: short lowercase words joined by dashes. */
export const ContentId = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/, 'ids are short lowercase words, such as "sun-tap"');

export function noRepeatedIds(entries: readonly { readonly id: string }[], key: string, ctx: z.RefinementCtx): void {
  const ids = entries.map((entry) => entry.id);
  ids.forEach((id, at) => {
    if (ids.indexOf(id) !== at) ctx.addIssue({ code: 'custom', message: `"${id}" appears twice`, path: [key, at, 'id'] });
  });
}

/**
 * One of the six weather types. A move of this type hits the types in `strongAgainst` harder and
 * the types in `weakAgainst` softer. While this weather is on the battlefield, moves of the types in
 * `field.boosts` grow stronger and moves of the types in `field.weakens` grow weaker. `colours`
 * tint the pictures of its moves; content:validate wants them on every type in `content/`, and the
 * frozen golden copies go without.
 */
export const WeatherType = z.strictObject({
  id: ContentId,
  name: LocalizedText,
  strongAgainst: z.array(ContentId).max(12),
  weakAgainst: z.array(ContentId).max(12),
  field: z.strictObject({ boosts: z.array(ContentId).max(12), weakens: z.array(ContentId).max(12) }),
  colours: Tint.optional(),
});
export type WeatherType = z.infer<typeof WeatherType>;

export const WeatherFile = z
  .strictObject({ types: z.array(WeatherType).min(1).max(12) })
  .superRefine(({ types }, ctx) => {
    noRepeatedIds(types, 'types', ctx);
    const known = new Set(types.map((type) => type.id));
    types.forEach((type, at) => {
      const lists = { strongAgainst: type.strongAgainst, weakAgainst: type.weakAgainst, 'field.boosts': type.field.boosts, 'field.weakens': type.field.weakens };
      for (const [list, ids] of Object.entries(lists)) {
        for (const id of ids) {
          if (!known.has(id)) ctx.addIssue({ code: 'custom', message: `${list} names "${id}", which is not a weather type`, path: ['types', at, ...list.split('.')] });
        }
      }
      for (const id of type.strongAgainst) {
        if (type.weakAgainst.includes(id)) ctx.addIssue({ code: 'custom', message: `"${type.id}" is both strong and weak against "${id}"`, path: ['types', at] });
      }
      for (const id of type.field.boosts) {
        if (type.field.weakens.includes(id)) ctx.addIssue({ code: 'custom', message: `"${type.id}" weather both boosts and weakens "${id}"`, path: ['types', at, 'field'] });
      }
    });
  });
export type WeatherFile = z.infer<typeof WeatherFile>;


// Arena numbers are whole numbers only, so every engine gets the same island: arena units (and
// units a second), ticks at 60 a second, percents, and angles as their cosine in 1/4096.
const ArenaUnits = z.number().int().min(0).max(5_000);
const PositiveUnits = ArenaUnits.min(1);
const ArenaTicks = z.number().int().min(0).max(36_000);
const ArenaPercent = z.number().int().min(0).max(100);
/** The share of a full hit one hit of the shape deals, in percent. */
const HitShare = z.number().int().min(1).max(200);
const Cosine = z.number().int().min(0).max(4_096);
const PieceCount = z.number().int().min(1).max(5);

const shot = { speed: PositiveUnits, radius: PositiveUnits, reach: PositiveUnits, knock: ArenaUnits, sharePercent: HitShare };

/**
 * Each shape's numbers. `arena.json` `shapes` gives every one of them; a move's `arena` block may
 * override any of its shape's. `reach` is how far a shot flies or where a thrown shape lands;
 * `armTicks` the wait before a thrown shape works; `slowPercent` the share of the walk cap left.
 */
export const ARENA_SHAPE_NUMBERS = {
  bolt: z.strictObject(shot),
  /** `count` bolts in a fan; `spreadCosine` is the angle between neighbouring bolts. */
  spray: z.strictObject({ ...shot, count: PieceCount, spreadCosine: Cosine }),
  cone: z.strictObject({ radius: PositiveUnits, halfAngleCosine: Cosine, knock: ArenaUnits, sharePercent: HitShare }),
  /** A bolt that roots for `rootTicks` and pulls the target `pull` units towards the caster. */
  snare: z.strictObject({ ...shot, rootTicks: ArenaTicks, pull: ArenaUnits }),
  lunge: z.strictObject({ speed: PositiveUnits, ticks: ArenaTicks.min(1), knock: ArenaUnits, sharePercent: HitShare }),
  burst: z.strictObject({ radius: PositiveUnits, knock: ArenaUnits, sharePercent: HitShare }),
  puddle: z.strictObject({ reach: PositiveUnits, radius: PositiveUnits, armTicks: ArenaTicks, ticks: ArenaTicks.min(1), slowPercent: ArenaPercent, sharePercent: HitShare }),
  shield: z.strictObject({ ticks: ArenaTicks.min(1), reflectPercent: ArenaPercent, knock: ArenaUnits }),
  /** `count` marks in a line along the aim, `spacing` units apart, the first at `reach`. */
  strike: z.strictObject({ reach: PositiveUnits, radius: PositiveUnits, armTicks: ArenaTicks, knock: ArenaUnits, count: PieceCount, spacing: ArenaUnits, sharePercent: HitShare }),
  wall: z.strictObject({ speed: PositiveUnits, radius: PositiveUnits, ticks: ArenaTicks.min(1), knock: ArenaUnits, sharePercent: HitShare }),
  freeze: z.strictObject({ reach: PositiveUnits, radius: PositiveUnits, armTicks: ArenaTicks, rootTicks: ArenaTicks, sharePercent: HitShare }),
  /** Pulses every `zonePulseTicks` for `sharePercent` of a hit, heals the caster `healPercent` of its health a pulse. */
  zone: z.strictObject({ radius: PositiveUnits, ticks: ArenaTicks.min(1), sharePercent: HitShare, healPercent: ArenaPercent, slowPercent: ArenaPercent }),
  /** No damage: a push ring, and the move's `setsWeather` for `weatherTicks`. */
  weather: z.strictObject({ radius: PositiveUnits, knock: ArenaUnits, weatherTicks: ArenaTicks.min(1) }),
} as const;

/** The farthest a shape's numbers reach from the caster, or undefined for a shape that stays by it. */
export function arenaReach(numbers: Readonly<Record<string, number>>): number | undefined {
  if (numbers.reach === undefined) return undefined;
  return numbers.reach + ((numbers.count ?? 1) - 1) * (numbers.spacing ?? 0);
}

const kindAndCooldown = { kind: z.enum(ARENA_KINDS), cooldownTicks: ArenaTicks.min(1).optional() };

/** A move's `arena` block: its kind and shape, a cooldown other than its kind's, and any of its shape's numbers. */
export const ArenaMove = z.discriminatedUnion('shape', [
  ARENA_SHAPE_NUMBERS.bolt.partial().extend({ shape: z.literal('bolt'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.spray.partial().extend({ shape: z.literal('spray'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.cone.partial().extend({ shape: z.literal('cone'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.snare.partial().extend({ shape: z.literal('snare'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.lunge.partial().extend({ shape: z.literal('lunge'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.burst.partial().extend({ shape: z.literal('burst'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.puddle.partial().extend({ shape: z.literal('puddle'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.shield.partial().extend({ shape: z.literal('shield'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.strike.partial().extend({ shape: z.literal('strike'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.wall.partial().extend({ shape: z.literal('wall'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.freeze.partial().extend({ shape: z.literal('freeze'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.zone.partial().extend({ shape: z.literal('zone'), ...kindAndCooldown }),
  ARENA_SHAPE_NUMBERS.weather.partial().extend({ shape: z.literal('weather'), ...kindAndCooldown }),
]);
export type ArenaMove = z.infer<typeof ArenaMove>;

/**
 * A move with `power` 0 only changes the weather, so it must name the weather it calls. `arena` is
 * how it works in an arena fight; content/ gives every move one (`ArenaMovesFile`), while frozen
 * golden copies from before the arena load without.
 */
export const Move = z
  .strictObject({
    id: ContentId,
    name: LocalizedText,
    type: ContentId,
    power: z.number().int().min(0).max(200),
    /** The chance to hit, in percent. Turn battles only: aiming and dodging replace it in the arena. */
    accuracy: z.number().int().min(1).max(100),
    setsWeather: ContentId.optional(),
    arena: ArenaMove.optional(),
  })
  .refine((move) => move.power > 0 || move.setsWeather !== undefined, 'a move needs power, setsWeather or both');
export type Move = z.infer<typeof Move>;

export const MovesFile = z.strictObject({ moves: z.array(Move).min(1).max(1_000) }).superRefine(({ moves }, ctx) => noRepeatedIds(moves, 'moves', ctx));
export type MovesFile = z.infer<typeof MovesFile>;

/** `content/creatures/moves.json`: every move also says how it works in the arena. */
export const ArenaMovesFile = MovesFile.superRefine(({ moves }, ctx) => {
  moves.forEach((move, at) => {
    if (move.arena === undefined) ctx.addIssue({ code: 'custom', message: `"${move.id}" needs an arena block with its kind and shape`, path: ['moves', at, 'arena'] });
  });
});

const BaseStat = z.number().int().min(1).max(255);

export const MAX_LEVEL = 100;
export const CreatureLevel = z.number().int().min(1).max(MAX_LEVEL);

/** A move a species learns when it reaches `level`. */
export const LearnsetEntry = z.strictObject({ level: CreatureLevel, move: ContentId });
export type LearnsetEntry = z.infer<typeof LearnsetEntry>;

/**
 * A learnset lists every move a species learns, in rising level order, each move once. It starts
 * with the species' four `moves` at level 1, in slot order, so a new creature knows those; every
 * later move is learned above level 1.
 */
function learnsetIssues({ moves, learnset }: { moves: readonly string[]; learnset?: readonly LearnsetEntry[] | undefined }): string[] {
  if (!learnset) return [];
  const issues: string[] = [];
  const start = learnset.filter((entry) => entry.level === 1).map((entry) => entry.move);
  if (start.join() !== moves.join()) issues.push(`the level 1 moves must be the four moves, in order: ${moves.join(', ')}`);
  if (learnset.some((entry, at) => at > 0 && entry.level < (learnset[at - 1]?.level ?? 1))) issues.push('the moves are listed in rising level order');
  const ids = learnset.map((entry) => entry.move);
  ids.forEach((id, at) => {
    if (ids.indexOf(id) !== at) issues.push(`"${id}" is learned twice`);
  });
  return issues;
}

export const Species = z
  .strictObject({
    id: ContentId,
    name: LocalizedText,
    /** One short line about the creature, for players. */
    description: LocalizedText.optional(),
    type: ContentId,
    /** Stands in until a real design replaces it. */
    placeholder: z.boolean().optional(),
    stats: z.strictObject({ hp: BaseStat, attack: BaseStat, defense: BaseStat, speed: BaseStat }),
    /** Every creature knows exactly four moves: these, at first. */
    moves: z.array(ContentId).length(4),
    learnset: z.array(LearnsetEntry).min(4).max(40).optional(),
    /** A treat in items.json this species loves most. See `treatLiking` in befriend.ts. */
    favouriteTreat: ContentId.optional(),
  })
  .refine((species) => new Set(species.moves).size === species.moves.length, 'a creature knows each move once')
  .superRefine((species, ctx) => {
    for (const message of learnsetIssues(species)) ctx.addIssue({ code: 'custom', message, path: ['learnset'] });
  });
export type Species = z.infer<typeof Species>;

export const SpeciesFile = z.strictObject({ species: z.array(Species).min(1).max(1_000) }).superRefine(({ species }, ctx) => noRepeatedIds(species, 'species', ctx));
export type SpeciesFile = z.infer<typeof SpeciesFile>;

/** Numbers that tune every battle. Percentages multiply damage; 100 changes nothing. */
export const BattleRules = z.strictObject({
  /** After this many turns the battle ends, and the side with more health left wins. */
  turnLimit: z.number().int().min(10).max(500),
  /** How many turns weather called by a move lasts, counting the turn it was called. */
  weatherTurns: z.number().int().min(1).max(20),
  strongPercent: z.number().int().min(100).max(400),
  weakPercent: z.number().int().min(10).max(100),
  boostPercent: z.number().int().min(100).max(300),
  weakenPercent: z.number().int().min(10).max(100),
  /** A move of the creature's own type. */
  sameTypePercent: z.number().int().min(100).max(200),
  /** Each hit rolls a damage percentage from this up to 100. */
  minRollPercent: z.number().int().min(50).max(100),
});
export type BattleRules = z.infer<typeof BattleRules>;

const Percent = z.number().int().min(0).max(100);

/**
 * How likely a wild creature is to accept a treat, in whole percent; `befriendChance` in
 * befriend.ts applies it. The chance starts at `basePercent`, gains up to `tiredPercent` as the
 * creature loses health (all of it at 0), gains `favouritePercent` or `likedPercent` for a treat it
 * loves or likes, loses `levelPenaltyPer10Levels` for every 10 levels it has, and is then held
 * between `minPercent` and `maxPercent`.
 */
export const BefriendRules = z
  .strictObject({
    basePercent: Percent,
    tiredPercent: Percent,
    favouritePercent: Percent,
    likedPercent: Percent,
    levelPenaltyPer10Levels: Percent,
    minPercent: Percent,
    maxPercent: Percent.min(1),
    /** In battle, a treat can be offered once the wild creature is at or below this share of its health. */
    windowPercent: Percent.min(1),
  })
  .refine((rules) => rules.minPercent <= rules.maxPercent, 'minPercent must not be above maxPercent')
  .refine((rules) => rules.likedPercent <= rules.favouritePercent, 'a liked treat must not beat a favourite one');
export type BefriendRules = z.infer<typeof BefriendRules>;

/** The most a treat's `strength` adds to the chance of befriending, in whole percent. */
export const MAX_TREAT_STRENGTH = 30;

/**
 * A treat to offer a wild creature. `likedBy.species` are creatures that love it (as their
 * favourite), `likedBy.types` are weather types whose creatures like it. `strength` (0 when
 * missing) adds to the chance after the liking bonus, so a cooked dish helps with any creature.
 */
export const Treat = z.strictObject({
  id: ContentId,
  kind: z.literal('treat'),
  name: LocalizedText,
  description: LocalizedText.optional(),
  strength: z.number().int().min(0).max(MAX_TREAT_STRENGTH).optional(),
  likedBy: z.strictObject({ species: z.array(ContentId).max(100), types: z.array(ContentId).max(12) }),
});
export type Treat = z.infer<typeof Treat>;

/**
 * Something a quest asks the player to carry, such as a letter to deliver. It belongs to `quest`,
 * never goes into battle, and is taken from the bag when it is delivered.
 */
export const QuestItem = z.strictObject({ id: ContentId, kind: z.literal('quest'), name: LocalizedText, description: LocalizedText, quest: ContentId });
export type QuestItem = z.infer<typeof QuestItem>;

/** Something gathered at a spot (foraging, fishing) and cooked into a dish. It never goes into battle. */
export const Ingredient = z.strictObject({ id: ContentId, kind: z.literal('ingredient'), name: LocalizedText, description: LocalizedText });
export type Ingredient = z.infer<typeof Ingredient>;

/** Something for building. Nothing uses materials yet; building comes in Slice D. */
export const Material = z.strictObject({ id: ContentId, kind: z.literal('material'), name: LocalizedText, description: LocalizedText });
export type Material = z.infer<typeof Material>;

/** The kinds of things a player can carry. `content/inventory.json` sets how many of each fit in one stack. */
export const ITEM_KINDS = ['quest', 'treat', 'ingredient', 'material'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Everything a player can carry, by `kind`. */
export const Item = z.discriminatedUnion('kind', [Treat, QuestItem, Ingredient, Material]);
export type Item = z.infer<typeof Item>;

export const ItemsFile = z.strictObject({ items: z.array(Item).min(1).max(1_000) }).superRefine(({ items }, ctx) => noRepeatedIds(items, 'items', ctx));
export type ItemsFile = z.infer<typeof ItemsFile>;

/** One kind of creature a zone can hold: levels from `minLevel` to `maxLevel`, picked by `weight` against the others. */
export const EncounterEntry = z
  .strictObject({ species: ContentId, minLevel: CreatureLevel, maxLevel: CreatureLevel, weight: z.number().int().min(1).max(1_000) })
  .refine((entry) => entry.minLevel <= entry.maxLevel, 'minLevel must not be above maxLevel');
export type EncounterEntry = z.infer<typeof EncounterEntry>;

/**
 * Tall grass where wild creatures live. A map marks where with a rectangle in its `encounters`
 * object layer, named by the zone's id. Each step onto a tile in the zone starts a battle with
 * `encounterPercent` chance, under `weather` (null for clear skies).
 */
export const EncounterZone = z.strictObject({
  id: ContentId,
  encounterPercent: Percent.min(1),
  weather: ContentId.nullable(),
  creatures: z.array(EncounterEntry).min(1).max(40),
});
export type EncounterZone = z.infer<typeof EncounterZone>;

export const EncountersFile = z.strictObject({ zones: z.array(EncounterZone).min(1).max(200) }).superRefine(({ zones }, ctx) => noRepeatedIds(zones, 'zones', ctx));
export type EncountersFile = z.infer<typeof EncountersFile>;

/** A shrine. A map places it with a point in its `shrines` object layer, named by the shrine's id. */
export const Shrine = z.strictObject({ id: ContentId, name: LocalizedText });
export type Shrine = z.infer<typeof Shrine>;

/**
 * What happens when a player's whole team faints: they wake at their last shrine (or the map's
 * player spawn before they have touched one), with the team healed when `healTeam` is set, keeping
 * `itemsKeptPercent` of each item they carry (rounded down; 100 loses nothing).
 */
export const TeamFaintedRules = z.strictObject({ healTeam: z.boolean(), itemsKeptPercent: Percent });
export type TeamFaintedRules = z.infer<typeof TeamFaintedRules>;

export const ShrinesFile = z
  .strictObject({ shrines: z.array(Shrine).min(1).max(200), teamFainted: TeamFaintedRules })
  .superRefine(({ shrines }, ctx) => noRepeatedIds(shrines, 'shrines', ctx));
export type ShrinesFile = z.infer<typeof ShrinesFile>;

/** What a new player chooses from and starts with: one of `species` at `level`, and `items`. */
export const StartersFile = z
  .strictObject({
    species: z.array(ContentId).length(3),
    level: CreatureLevel,
    items: z.array(z.strictObject({ item: ContentId, count: z.number().int().min(1).max(99) })).max(10),
  })
  .refine(({ species }) => new Set(species).size === species.length, 'each starter is a different species')
  .refine(({ items }) => new Set(items.map(({ item }) => item)).size === items.length, 'each starting item appears once');
export type StartersFile = z.infer<typeof StartersFile>;

/**
 * Species ids that were renamed or replaced, each old id mapped to the species that now stands in
 * for it, so a save that names an old id still loads. Old ids stay here for good, because old saves
 * do; when a species is renamed again, point its old ids straight at the new one.
 */
export const RenamedFile = z
  .strictObject({ species: z.record(ContentId, ContentId) })
  .superRefine(({ species }, ctx) => {
    for (const [from, to] of Object.entries(species)) {
      if (Object.hasOwn(species, to)) ctx.addIssue({ code: 'custom', message: `"${from}" becomes "${to}", which is renamed too; name the species it ends up as`, path: ['species', from] });
    }
  });
export type RenamedFile = z.infer<typeof RenamedFile>;

const ArenaKindRules = z.strictObject({
  /** Ticks a move of this kind cools down after use, unless the move gives its own. */
  cooldownTicks: ArenaTicks.min(1),
  /** Ticks the button cools down at the start of a fight. */
  openingTicks: ArenaTicks,
  /** Ticks the computer's creature winds up, shown by a telegraph, before casting. */
  windupTicks: ArenaTicks,
});

/**
 * Every number of an arena fight (docs/arena.md, "Every tunable"), in whole numbers: arena units,
 * units a second, ticks at 60 a second, permille, percents and cosines in 1/4096. `buttons` are the
 * levels buttons 1 to 3 unlock at. The checks keep the island fair to play on: the storm's floor
 * fits two creatures side by side, nothing reaches across the whole island, and each kind of
 * button cools down quicker than the next. Checks that need moves and species are in
 * `arenaLinkProblems` (arena-links.ts).
 */
const Whole = (min: number, max: number) => z.number().int().min(min).max(max);

/** The island's size and how bodies move on it (arena/step.ts). */
export const ArenaIslandRules = z.strictObject({
  radius: Whole(100, 5_000),
  /** A creature's body radius. A body falls (ring-out) once it is a whole body past the edge. */
  body: Whole(4, 500),
  frictionPermille: Whole(1, 999),
  plantedPermille: Whole(1, 1_000),
  walkBase: Whole(1, 5_000),
  walkPerSpeedPercent: Whole(0, 10_000),
  topSpeed: Whole(1, 10_000),
  hpScale: Whole(1, 20),
  knockBasePercent: Whole(0, 1_000),
  knockLostPercent: Whole(0, 1_000),
  knockedTicks: Whole(0, 600),
  bumpKnock: Whole(0, 10_000),
  limitTicks: Whole(60, 60 * 60 * 30),
});
export type ArenaIslandRules = z.infer<typeof ArenaIslandRules>;

export const ArenaDashRules = z.strictObject({
  speed: Whole(1, 10_000),
  ticks: Whole(1, 600),
  cooldownTicks: Whole(1, 6_000),
});
export type ArenaDashRules = z.infer<typeof ArenaDashRules>;

export const ArenaStormRules = z
  .strictObject({
    firstTicks: Whole(1, 60 * 60 * 30),
    everyTicks: Whole(1, 60 * 60 * 30),
    warnTicks: Whole(0, 6_000),
    shrinkTicks: Whole(1, 6_000),
    /** How many shrinks take `bigStepPercent` of the starting radius before they take `smallStepPercent`. */
    bigSteps: Whole(0, 100),
    bigStepPercent: Whole(1, 100),
    smallStepPercent: Whole(1, 100),
    floorPercent: Whole(1, 100),
  })
  .refine((storm) => storm.warnTicks < storm.firstTicks, 'the first storm warning comes after the fight starts')
  .refine((storm) => storm.warnTicks + storm.shrinkTicks <= storm.everyTicks, 'a shrink and the next warning fit between two shrinks');
export type ArenaStormRules = z.infer<typeof ArenaStormRules>;

/** The computer's minds (arena/mind.ts): `WILD` for wild creatures, `WILD_EASIER` against the turtle setting, `BOT` for tests and trainers. */
export const ARENA_MINDS = ['WILD', 'WILD_EASIER', 'BOT'] as const;
export const ArenaMindName = z.enum(ARENA_MINDS);
export type ArenaMindName = z.infer<typeof ArenaMindName>;

/** How well a mind plays. */
export const ArenaMindSkill = z.strictObject({
  /** Ticks between choosing where to walk. */
  thinkTicks: Whole(1, 600),
  /** The chance of dashing aside from a shot, a lunge or a wind-up coming at it. */
  dodgePercent: ArenaPercent,
  /** The largest aim error, as the cosine in 1/4096 of its angle. */
  aimErrorCosine: Cosine,
  /** How much of the target's movement it aims a shot ahead by. */
  leadPercent: ArenaPercent,
  /** Ticks it waits after an ability before the next: 50 to 150% of this. */
  reactTicks: ArenaTicks,
  /** The chance a tick, in permille, of starting a ready special or ultimate when the moment is right. */
  eagerPermille: Whole(0, 1_000),
});
export type ArenaMindSkill = z.infer<typeof ArenaMindSkill>;

export const ArenaMindRules = z.strictObject({
  skills: z.strictObject({ WILD: ArenaMindSkill, WILD_EASIER: ArenaMindSkill, BOT: ArenaMindSkill }),
  /** A mind stays this far inside the edge, or inside the edge the storm is about to shrink to. */
  edgeMargin: ArenaUnits,
  /** The distance a mind likes to fight at, by the shape of its button 1 move. */
  ranges: z.record(z.enum(ARENA_SHAPES), ArenaUnits),
});
export type ArenaMindRules = z.infer<typeof ArenaMindRules>;

const ArenaRulesObject = z.strictObject({
  island: ArenaIslandRules,
  dash: ArenaDashRules,
  swap: z.strictObject({ cooldownTicks: ArenaTicks }),
  storm: ArenaStormRules,
  treat: z.strictObject({
    windowPercent: ArenaPercent.min(1),
    likedWindowPercent: ArenaPercent.min(1),
    favouriteWindowPercent: ArenaPercent.min(1),
    speed: PositiveUnits,
    range: PositiveUnits,
    radius: PositiveUnits,
    likedRadius: PositiveUnits,
    favouriteRadius: PositiveUnits,
    groundTicks: ArenaTicks,
    againTicks: ArenaTicks,
  }),
  kinds: z.strictObject({ quick: ArenaKindRules, special: ArenaKindRules, ultimate: ArenaKindRules }),
  buttons: z.tuple([CreatureLevel, CreatureLevel, CreatureLevel]),
  /** The turtle setting. */
  easier: z.strictObject({
    walkPercent: ArenaPercent.min(1),
    windupPercent: z.number().int().min(100).max(400),
    cooldownPercent: z.number().int().min(100).max(400),
    damageTakenPercent: ArenaPercent.min(1),
  }),
  /** A cast bends towards the other creature within this angle of the facing and this distance. */
  aimHelp: z.strictObject({ cosine: Cosine, range: ArenaUnits }),
  zonePulseTicks: ArenaTicks.min(1),
  wallThickness: PositiveUnits,
  /** How long an ultimate's own type's weather lasts on the island. */
  ultimateWeatherTicks: ArenaTicks,
  /** The arena's own type chart, softer than turn battles' `battle-rules.json`: a strong hit and a weak one, in percent. */
  strongPercent: Whole(100, 400),
  weakPercent: Whole(10, 100),
  shapes: z.strictObject(ARENA_SHAPE_NUMBERS),
  minds: ArenaMindRules,
});

export const ArenaRules = ArenaRulesObject.superRefine((rules, ctx) => {
  for (const { message, path } of arenaRuleIssues(rules)) ctx.addIssue({ code: 'custom', message, path });
});
export type ArenaRules = z.infer<typeof ArenaRules>;

type RuleIssue = { readonly message: string; readonly path: (string | number)[] };

const KIND_PAIRS = [
  ['quick', 'special'],
  ['special', 'ultimate'],
] as const;

function arenaRuleIssues({ island, storm, treat, kinds, buttons, shapes, strongPercent, weakPercent }: z.infer<typeof ArenaRulesObject>): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const diameter = 2 * island.radius;
  const floorDiameter = 2 * Math.floor((island.radius * storm.floorPercent) / 100);
  if (floorDiameter <= 4 * island.body) issues.push({ message: `the storm's floor, ${floorDiameter} across, must be wider than two bodies side by side (${4 * island.body})`, path: ['storm', 'floorPercent'] });
  for (const shape of ARENA_SHAPES) {
    const reach = arenaReach(shapes[shape]);
    if (reach !== undefined && reach >= diameter) issues.push({ message: `a ${shape} reaches ${reach}, which must be shorter than the island's diameter (${diameter})`, path: ['shapes', shape] });
  }
  if (treat.range >= diameter) issues.push({ message: `a treat flies ${treat.range}, which must be shorter than the island's diameter (${diameter})`, path: ['treat', 'range'] });
  for (const [quicker, kind] of KIND_PAIRS) {
    if (kinds[quicker].cooldownTicks >= kinds[kind].cooldownTicks) {
      issues.push({ message: `${quicker} moves cool down in ${kinds[quicker].cooldownTicks} ticks, which must be quicker than ${kind} moves (${kinds[kind].cooldownTicks})`, path: ['kinds', quicker, 'cooldownTicks'] });
    }
  }
  if (buttons[0] !== 1) issues.push({ message: 'button 1 is there from level 1', path: ['buttons', 0] });
  if (buttons[1] <= buttons[0] || buttons[2] <= buttons[1]) issues.push({ message: 'buttons unlock at rising levels', path: ['buttons'] });
  if (treat.likedWindowPercent < treat.windowPercent || treat.favouriteWindowPercent < treat.likedWindowPercent) issues.push({ message: 'a liked treat must not open a smaller window than a plain one, nor a favourite than a liked one', path: ['treat'] });
  if (treat.likedRadius < treat.radius || treat.favouriteRadius < treat.likedRadius) issues.push({ message: 'a liked treat must not be smaller than a plain one, nor a favourite than a liked one', path: ['treat'] });
  if (strongPercent <= 100) issues.push({ message: `a strong hit does ${strongPercent}%, which must be more than 100%`, path: ['strongPercent'] });
  if (weakPercent >= 100) issues.push({ message: `a weak hit does ${weakPercent}%, which must be less than 100%`, path: ['weakPercent'] });
  return issues;
}
