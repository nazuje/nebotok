import { z } from 'zod';
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
  'walk.blocked',
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
  'battle.back',
  'battle.won',
  'battle.over',
  'battle.interrupted',
  'battle.xp',
  'battle.levelUp',
  'battle.learned',
  'learn.wants',
  'learn.new',
  'learn.forget',
  'learn.skip',
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
 * `field.boosts` grow stronger and moves of the types in `field.weakens` grow weaker.
 */
export const WeatherType = z.strictObject({
  id: ContentId,
  name: LocalizedText,
  strongAgainst: z.array(ContentId).max(12),
  weakAgainst: z.array(ContentId).max(12),
  field: z.strictObject({ boosts: z.array(ContentId).max(12), weakens: z.array(ContentId).max(12) }),
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

/** A move with `power` 0 only changes the weather, so it must name the weather it calls. */
export const Move = z
  .strictObject({
    id: ContentId,
    name: LocalizedText,
    type: ContentId,
    power: z.number().int().min(0).max(200),
    /** The chance to hit, in percent. */
    accuracy: z.number().int().min(1).max(100),
    setsWeather: ContentId.optional(),
  })
  .refine((move) => move.power > 0 || move.setsWeather !== undefined, 'a move needs power, setsWeather or both');
export type Move = z.infer<typeof Move>;

export const MovesFile = z.strictObject({ moves: z.array(Move).min(1).max(1_000) }).superRefine(({ moves }, ctx) => noRepeatedIds(moves, 'moves', ctx));
export type MovesFile = z.infer<typeof MovesFile>;

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

/**
 * A treat to offer a wild creature. `likedBy.species` are creatures that love it (as their
 * favourite), `likedBy.types` are weather types whose creatures like it.
 */
export const Treat = z.strictObject({
  id: ContentId,
  kind: z.literal('treat'),
  name: LocalizedText,
  description: LocalizedText.optional(),
  likedBy: z.strictObject({ species: z.array(ContentId).max(100), types: z.array(ContentId).max(12) }),
});
export type Treat = z.infer<typeof Treat>;

/**
 * Something a quest asks the player to carry, such as a letter to deliver. It belongs to `quest`,
 * never goes into battle, and is taken from the bag when it is delivered.
 */
export const QuestItem = z.strictObject({ id: ContentId, kind: z.literal('quest'), name: LocalizedText, description: LocalizedText, quest: ContentId });
export type QuestItem = z.infer<typeof QuestItem>;

/** Something gathered for crafting. Nothing uses materials yet; Slice C (skills) does. */
export const Material = z.strictObject({ id: ContentId, kind: z.literal('material'), name: LocalizedText, description: LocalizedText });
export type Material = z.infer<typeof Material>;

/** The kinds of things a player can carry. `content/inventory.json` sets how many of each fit in one stack. */
export const ITEM_KINDS = ['quest', 'treat', 'material'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Everything a player can carry, by `kind`. */
export const Item = z.discriminatedUnion('kind', [Treat, QuestItem, Material]);
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
